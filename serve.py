import http.server, json, os, re, urllib.parse, uuid, base64, shutil, subprocess
from socketserver import ThreadingMixIn

# Project root = where serve.py lives; static frontend = webeditor/ subdirectory.
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
WEBEDITOR_DIR = os.path.join(PROJECT_ROOT, 'webeditor')

class ThreadedHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    def finish_request(self, request, client_address):
        # Set socket timeout to 30.0s to prevent connections from hanging indefinitely
        request.settimeout(30.0)
        super().finish_request(request, client_address)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve static files from webeditor/ by default
        super().__init__(*args, directory=WEBEDITOR_DIR, **kwargs)

    def translate_path(self, path):
        """Route /assets/* and /prompts/* to project root; everything else to webeditor/."""
        rel = urllib.parse.unquote(urllib.parse.urlparse(path).path).lstrip('/')
        # Shared data dirs live in project root, not webeditor/
        if rel.startswith('assets/') or rel.startswith('prompts/'):
            resolved = os.path.realpath(os.path.join(PROJECT_ROOT, rel))
            root_prefix = os.path.realpath(PROJECT_ROOT) + os.sep
            if not resolved.startswith(root_prefix) and resolved != os.path.realpath(PROJECT_ROOT):
                return super().translate_path('/404-blocked')
            return resolved
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # Unique ETag prevents 304 Not Modified
        self.send_header('ETag', f'"{uuid.uuid4().hex}"')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/assets':
            return self._handle_api_assets()
        if self.path.startswith('/api/status'):
            return self._handle_api_status()
        if self.path.startswith('/api/prompt'):
            return self._handle_api_prompt_get()
        if self.path == '/api/agent-config':
            return self._handle_api_agent_config()
        # Override to prevent conditional responses
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        super().do_GET()

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            content_length = 0
        if content_length > 30 * 1024 * 1024:
            self.send_error(413, 'Payload Too Large')
            return

        # Read body once, pass to handler — prevents length mismatch and double-read
        raw = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return self._send_json({'ok': False, 'error': 'Invalid JSON body'}, 400)

        if self.path == '/api/prompt':
            return self._handle_api_prompt(data)
        if self.path == '/api/save':
            return self._handle_api_save(data)
        self.send_error(404, 'Unknown endpoint')

    def _handle_api_save(self, data):
        """Save atlas.json and optional keyed image directly to disk."""
        try:
            char_raw = data.get('char', '')
            if not char_raw or not re.match(r'^[A-Za-z0-9_-]+$', str(char_raw)):
                return self._send_json({'ok': False, 'error': 'Invalid char parameter'}, 400)
            char = str(char_raw)

            prefix_raw = data.get('prefix', '')
            if prefix_raw and not re.match(r'^[A-Za-z0-9_-]+$', str(prefix_raw)):
                return self._send_json({'ok': False, 'error': 'Invalid prefix parameter'}, 400)
            prefix = str(prefix_raw) if prefix_raw else ''
            
            atlas_data = data.get('atlas')
            keyed_image_b64 = data.get('keyedImage')

            target_dir = os.path.join(PROJECT_ROOT, 'assets', char)
            if prefix:
                target_dir = os.path.join(target_dir, prefix)

            os.makedirs(target_dir, exist_ok=True)

            # 1. Save atlas.json
            if atlas_data:
                atlas_path = os.path.join(target_dir, 'atlas.json')
                with open(atlas_path, 'w', encoding='utf-8') as f:
                    json.dump(atlas_data, f, indent=2)

            # 2. Save keyed image
            if keyed_image_b64 and ',' in keyed_image_b64:
                header, encoded = keyed_image_b64.split(',', 1)
                img_data = base64.b64decode(encoded)
                
                base_name = f'{char}.png'
                if atlas_data:
                    base_name = atlas_data.get('meta', {}).get('image', f'{char}.png')
                
                # Sanitize client-provided filename
                base_name = os.path.basename(base_name)
                base_name = re.sub(r'[^A-Za-z0-9_.-]', '_', base_name)
                
                root, _ = os.path.splitext(base_name)
                img_name = f'{root}_keyed.png'
                
                img_path = os.path.realpath(os.path.join(target_dir, img_name))
                target_dir_real = os.path.realpath(target_dir) + os.sep
                
                # Ensure the resolved path is still within target_dir (Path Traversal protection)
                if not img_path.startswith(target_dir_real) and img_path != os.path.realpath(target_dir):
                    return self._send_json({'ok': False, 'error': 'Path traversal detected'}, 400)
                
                with open(img_path, 'wb') as f:
                    f.write(img_data)
                
                # If cwebp is available, compress a copy to WebP for optimization
                cwebp_bin = shutil.which("cwebp")
                if cwebp_bin:
                    webp_img_path = os.path.join(target_dir, f'{root}_keyed.webp')
                    try:
                        subprocess.run(
                            [cwebp_bin, "-q", "90", img_path, "-o", webp_img_path],
                            check=True,
                            capture_output=True,
                            timeout=30.0
                        )
                    except subprocess.TimeoutExpired:
                        print("cwebp keyed image compression timed out")
                    except Exception as e:
                        print(f"cwebp keyed image compression failed: {e}")

            self._send_json({'ok': True})
        except Exception as e:
            print(f"Error in /api/save: {e}")
            self._send_json({'ok': False, 'error': 'Internal server error'}, 500)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_api_status(self):
        """Return atlas/sheet mtimes so the editor can poll for regenerations."""
        qs = urllib.parse.urlparse(self.path).query
        char_raw = urllib.parse.parse_qs(qs).get('char', [''])[0]
        if not char_raw or not re.match(r'^[A-Za-z0-9_-]+$', char_raw):
            return self._send_json({'ok': False, 'error': 'Invalid char parameter'}, 400)
        char = char_raw
        base = os.path.join(PROJECT_ROOT, 'assets', char)

        def mtime(*parts):
            p = os.path.join(base, *parts)
            return os.path.getmtime(p) if os.path.isfile(p) else 0

        # Check output/ first, then root
        atlas_prefix = ''
        if os.path.isfile(os.path.join(base, 'output', 'atlas.json')):
            atlas_prefix = 'output'

        atlas_path = os.path.join(base, atlas_prefix, 'atlas.json')
        img_name = 'sheet.png'
        if os.path.isfile(atlas_path):
            try:
                with open(atlas_path, 'r', encoding='utf-8') as f:
                    atlas_data = json.load(f)
                img_name = atlas_data.get('meta', {}).get('image', 'sheet.png')
            except Exception:
                img_name = f'{char}.png'

        atlas_m = mtime(atlas_prefix, 'atlas.json') if atlas_prefix else mtime('atlas.json')
        sheet_m = mtime(atlas_prefix, img_name) if atlas_prefix else mtime(img_name)

        self._send_json({'char': char, 'atlasMtime': atlas_m, 'sheetMtime': sheet_m})

    def _handle_api_prompt_get(self):
        """Return a saved prompt's text (always 200, so the editor never logs a 404)."""
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        char_raw = qs.get('char', [''])[0]
        if not char_raw or not re.match(r'^[A-Za-z0-9_-]+$', char_raw):
            return self._send_json({'exists': False, 'text': ''})
        char = char_raw
        safe = re.sub(r'[^A-Za-z0-9_.-]', '_', qs.get('name', [''])[0])
        text, exists = '', False
        if char and safe:
            fname = safe if safe.endswith('.txt') else safe + '.txt'
            path = os.path.join(PROJECT_ROOT, 'assets', char, 'prompts', fname)
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    text = f.read()
                exists = True
        self._send_json({'exists': exists, 'text': text})

    def _handle_api_prompt(self, data):
        """Persist a synthesised/edited prompt to assets/<char>/prompts/<name>.txt."""
        try:
            char_raw = data.get('char', '')
            if not char_raw or not re.match(r'^[A-Za-z0-9_-]+$', str(char_raw)):
                return self._send_json({'ok': False, 'error': 'Invalid char parameter'}, 400)
            char = str(char_raw)
            safe = re.sub(r'[^A-Za-z0-9_.-]', '_', str(data.get('name', '')))
            text = str(data.get('text', ''))
            if not char or not safe:
                return self._send_json({'ok': False, 'error': 'char and name required'}, 400)
            pdir = os.path.join(PROJECT_ROOT, 'assets', char, 'prompts')
            os.makedirs(pdir, exist_ok=True)
            fname = safe if safe.endswith('.txt') else safe + '.txt'
            path = os.path.join(pdir, fname)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text)
            self._send_json({'ok': True, 'path': os.path.relpath(path, PROJECT_ROOT)})
        except Exception as e:
            print(f"Error in /api/prompt: {e}")
            self._send_json({'ok': False, 'error': 'Internal server error'}, 500)

    def _handle_api_assets(self):
        assets_dir = os.path.join(PROJECT_ROOT, 'assets')
        result = []
        if os.path.isdir(assets_dir):
            for name in sorted(os.listdir(assets_dir)):
                sub = os.path.join(assets_dir, name)
                if not os.path.isdir(sub):
                    continue
                # Check output/ first, then root
                out_dir = os.path.join(sub, 'output')
                if os.path.isfile(os.path.join(out_dir, 'atlas.json')):
                    atlas_prefix = 'output'
                elif os.path.isfile(os.path.join(sub, 'atlas.json')):
                    atlas_prefix = ''
                else:
                    atlas_prefix = None
                has_atlas = atlas_prefix is not None
                
                has_sheet = False
                if has_atlas:
                    atlas_path = os.path.join(sub, atlas_prefix, 'atlas.json')
                    try:
                        with open(atlas_path, 'r', encoding='utf-8') as f:
                            atlas_data = json.load(f)
                        img_name = atlas_data.get('meta', {}).get('image', 'sheet.png')
                        has_sheet = os.path.isfile(os.path.join(sub, atlas_prefix, img_name))
                    except Exception:
                        has_sheet = os.path.isfile(os.path.join(sub, atlas_prefix, f'{name}.png')) or os.path.isfile(os.path.join(sub, atlas_prefix, 'sheet.png'))
                        
                has_tpose = os.path.isfile(os.path.join(sub, 'tpose.png'))
                has_input = os.path.isfile(os.path.join(sub, 'input.png'))
                result.append({
                    'name': name,
                    'hasAtlas': has_atlas,
                     'hasSheet': has_sheet,
                    'atlasPrefix': atlas_prefix or '',
                    'hasReference': has_tpose or has_input,
                })
        self._send_json(result)

    def _handle_api_agent_config(self):
        """Return a local-only stdio MCP configuration for agent handoff."""
        if self.client_address[0] not in ('127.0.0.1', '::1'):
            return self._send_json({'ok': False, 'error': 'Agent config is available only from localhost.'}, 403)
        entrypoint = os.path.join(PROJECT_ROOT, 'mcp-server', 'dist', 'index.js')
        self._send_json({
            'ok': os.path.isfile(entrypoint),
            'buildCommand': 'cd mcp-server && npm install && npm run check',
            'codexToml': (
                '[mcp_servers.aiplaybook]\n'
                f'command = "node"\nargs = ["{entrypoint}"]\n\n'
                '[mcp_servers.aiplaybook.env]\n'
                f'AIPLAYBOOK_ROOT = "{PROJECT_ROOT}"\n'
            ),
            'config': {
                'mcpServers': {
                    'aiplaybook': {
                        'command': 'node',
                        'args': [entrypoint],
                        'env': {'AIPLAYBOOK_ROOT': PROJECT_ROOT},
                    },
                },
            },
        })

if __name__ == '__main__':
    host = os.environ.get('AIPLAYBOOK_HOST', '127.0.0.1')
    try:
        port = int(os.environ.get('AIPLAYBOOK_PORT', '8080'))
    except ValueError as exc:
        raise SystemExit('AIPLAYBOOK_PORT must be an integer') from exc
    if not 1 <= port <= 65535:
        raise SystemExit('AIPLAYBOOK_PORT must be between 1 and 65535')

    print(f"Dev server on http://{host}:{port} (no-cache)")
    ThreadedHTTPServer((host, port), NoCacheHandler).serve_forever()
