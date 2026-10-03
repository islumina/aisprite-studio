"""CLI entrypoint for the sprite image pipeline.

Usage:
    python -m tools.sprite_pipeline.cli generate assets/reimu
    python -m tools.sprite_pipeline.cli qa assets/reimu [--skip-vision]
    python -m tools.sprite_pipeline.cli pack assets/reimu
    python -m tools.sprite_pipeline.cli validate assets/reimu/output/atlas.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

import yaml


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="sprite-pipeline",
        description="Host-neutral sprite generation, QA, and packing pipeline",
    )
    p.add_argument(
        "-v", "--verbose", action="store_true", help="Enable debug logging",
    )

    sub = p.add_subparsers(dest="command", required=True)

    # generate
    gen = sub.add_parser("generate", help="Print exact tasks for an image-capable agent")
    gen.add_argument("asset_dir", type=Path, help="Asset directory (e.g. assets/reimu)")

    # sync
    sync_cmd = sub.add_parser("sync", help="Remove timestamps from generated frame filenames")
    sync_cmd.add_argument("asset_dir", type=Path, help="Asset directory")

    # qa
    qa = sub.add_parser("qa", help="Run QA checks on generated frames")
    qa.add_argument("asset_dir", type=Path, help="Asset directory")
    qa.add_argument("--size", type=int, default=512, help="Expected frame size")
    qa.add_argument("--skip-vision", action="store_true", help="Skip vision QA (saves API calls)")

    # pack
    pk = sub.add_parser("pack", help="Pack frames into spritesheet + atlas.json")
    pk.add_argument("asset_dir", type=Path, help="Asset directory")
    pk.add_argument("--size", type=int, default=512, help="Frame size when request.yml has none")
    pk.add_argument("--fresh", action="store_true", help="Ignore anchors, durations and states saved in atlas.json")

    # validate
    val = sub.add_parser("validate", help="Validate an atlas.json against schema")
    val.add_argument("atlas_path", type=Path, help="Path to atlas.json")

    return p.parse_args()


def _load_request(asset_dir: Path) -> dict:
    """Load and parse request.yml from an asset directory."""
    req_path = asset_dir / "request.yml"
    if not req_path.exists():
        print(f"Error: {req_path} not found", file=sys.stderr)
        sys.exit(1)
    with open(req_path) as f:
        data = yaml.safe_load(f)
    if not data:
        print(f"Error: {req_path} is empty", file=sys.stderr)
        sys.exit(1)
    return data


def _require_pack_approval(asset_dir: Path) -> None:
    """Block packaging until deterministic and visual QA both pass."""
    report_path = asset_dir / "qa-report.json"
    if not report_path.is_file():
        raise SystemExit(f"Packing blocked: {report_path} is missing. Run QA first.")

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Packing blocked: invalid QA report: {exc}") from exc

    if not isinstance(report, dict):
        raise SystemExit("Packing blocked: QA report must be a JSON object.")

    if report.get("overall") != "pass":
        raise SystemExit(
            f"Packing blocked: QA overall is {report.get('overall', 'missing')!r}, expected 'pass'."
        )

    visual_qa = report.get("visual_qa")
    if not isinstance(visual_qa, dict):
        raise SystemExit("Packing blocked: visual_qa must be a JSON object.")

    visual_status = visual_qa.get("status")
    if visual_status != "pass":
        raise SystemExit(
            "Packing blocked: visual_qa.status must be 'pass'; deterministic checks alone are insufficient."
        )


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

async def _cmd_generate(args: argparse.Namespace) -> None:
    from . import generation_plan
    
    print("==========================================================")
    print("提示：本地腳本不包含 API Key，因此不會自動執行生圖。")
    print("請將下列 task 交給具備圖片編輯能力的 agent，並透過本機 MCP 驗證提交。\n")
    
    # 讓腳本印出助理生圖時需要的精準資訊，減輕助理的運算負擔
    print("--- 助理專用生圖計畫 (Generation Plan) ---")
    plan = generation_plan.build_generation_plan(args.asset_dir)
    print(plan)
    print("==========================================================")

def _cmd_sync(args: argparse.Namespace) -> None:
    import re
    frames_dir = args.asset_dir / "frames"
    if not frames_dir.exists():
        print(f"Error: {frames_dir} not found.")
        return

    pattern = re.compile(r"^(.*?)_\d{13,}\.png$")
    count = 0
    for file_path in frames_dir.glob("*.png"):
        match = pattern.match(file_path.name)
        if match:
            clean_name = f"{match.group(1)}.png"
            new_path = file_path.with_name(clean_name)
            
            # If the clean file already exists, it might be an older version, so overwrite it
            if new_path.exists():
                new_path.unlink()
                
            file_path.rename(new_path)
            count += 1
            print(f"Synced: {file_path.name} -> {clean_name}")
            
    if count == 0:
        print("No files needed syncing.")
    else:
        print(f"Synced {count} files.")


async def _cmd_qa(args: argparse.Namespace) -> None:
    from . import qa

    from .spec import frame_specs

    request = _load_request(args.asset_dir)
    specs = frame_specs(request)
    frame_names = [s["name"] for s in specs]
    # Use frame_size from request.yml if --size was not explicitly set
    expected_size = request.get("frame_size", args.size)

    print(f"Running QA on {len(frame_names)} frames (size={expected_size})...")

    report = await qa.run_suite(
        asset_dir=args.asset_dir,
        frame_names=frame_names,
        expected_size=expected_size,
        skip_vision=args.skip_vision,
        asset_type=request.get("asset_type", "character"),
    )

    out_path = args.asset_dir / "qa-report.json"
    qa.write_report(report, out_path)

    print(f"Overall: {report['overall']}")
    for name, fr in report["frames"].items():
        if fr["status"] != "pass":
            print(f"  {name}: {fr['status']}")


def _cmd_pack(args: argparse.Namespace) -> None:
    from . import packer

    _require_pack_approval(args.asset_dir)
    request = _load_request(args.asset_dir)
    request.setdefault("frame_size", args.size)

    print(f"Packing {args.asset_dir} (size={request['frame_size']})...")
    try:
        atlas = packer.pack(args.asset_dir, request, fresh=args.fresh)
    except (FileNotFoundError, ValueError) as exc:
        raise SystemExit(f"Packing failed: {exc}") from exc

    # Validate the generated atlas
    from .schema_validator import validate_atlas
    errors = validate_atlas(atlas)
    if errors:
        print("Atlas validation warnings:")
        for e in errors:
            print(f"  {e}")
    else:
        print("Atlas validates OK")

    print(f"Output: {args.asset_dir / 'output'}")


def _cmd_validate(args: argparse.Namespace) -> None:
    from .schema_validator import validate_atlas_file

    errors = validate_atlas_file(args.atlas_path)
    if errors:
        print(f"Validation failed ({len(errors)} errors):")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("Valid ✓")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = _parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(name)s %(levelname)s %(message)s")

    if args.command == "generate":
        asyncio.run(_cmd_generate(args))
    elif args.command == "sync":
        _cmd_sync(args)
    elif args.command == "qa":
        asyncio.run(_cmd_qa(args))
    elif args.command == "pack":
        _cmd_pack(args)
    elif args.command == "validate":
        _cmd_validate(args)


if __name__ == "__main__":
    main()
