from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from tools.sprite_pipeline import chroma

# Generators paint the key off-spec; these are measured from the bundled fixtures.
PAINTED_GREEN = (10, 238, 7)
PAINTED_BLUE = (20, 62, 181)


def _frame(background: tuple[int, int, int], subject: tuple[int, int, int], size: int = 64) -> np.ndarray:
    frame = np.zeros((size, size, 4), dtype=np.uint8)
    frame[..., :3] = background
    frame[..., 3] = 255
    frame[16:48, 16:48, :3] = subject
    return frame


class ChromaTests(unittest.TestCase):
    def test_measures_the_painted_key_not_the_requested_hex(self) -> None:
        for painted in (PAINTED_GREEN, PAINTED_BLUE):
            key = chroma.measure_key(_frame(painted, (200, 40, 40))[..., :3])
            np.testing.assert_allclose(key, painted, atol=1)

    def test_keeps_a_blue_subject_on_a_green_screen(self) -> None:
        # The old packer removed green and blue on every frame and erased blue flames.
        keyed, key = chroma.key_image(Image.fromarray(_frame(PAINTED_GREEN, (30, 90, 250))))
        alpha = np.asarray(keyed)[..., 3]
        self.assertEqual(chroma.key_family(key), "green")
        self.assertTrue((alpha[20:44, 20:44] == 255).all())
        self.assertTrue((alpha[:8] == 0).all())

    def test_unmixes_a_half_key_edge_pixel(self) -> None:
        frame = _frame(PAINTED_GREEN, (200, 40, 40))
        blend = np.rint(0.5 * np.array([200, 40, 40]) + 0.5 * np.array(PAINTED_GREEN)).astype(np.uint8)
        frame[16:48, 15, :3] = blend
        keyed = np.asarray(chroma.key_image(Image.fromarray(frame))[0])
        edge = keyed[30, 15]
        self.assertAlmostEqual(edge[3] / 255, 0.5, delta=0.06)
        np.testing.assert_allclose(edge[:3], (200, 40, 40), atol=12)

    def test_unmixes_a_wide_glow_painted_over_the_screen(self) -> None:
        frame = _frame(PAINTED_GREEN, (40, 60, 230))
        # A 12 px glow fading from the subject into the key colour.
        for step in range(12):
            share = (step + 1) / 13
            colour = np.rint((1 - share) * np.array([40, 60, 230]) + share * np.array(PAINTED_GREEN))
            frame[16:48, 15 - step, :3] = colour
        keyed = np.asarray(chroma.key_image(Image.fromarray(frame))[0])
        glow = keyed[30, 4:16]
        visible = glow[glow[:, 3] > 0, :3].astype(int)
        self.assertTrue(len(visible) > 0)
        # No visible glow pixel keeps a green cast.
        self.assertTrue((visible[:, 1] <= visible[:, 2]).all(), visible)

    def test_refuses_a_border_that_is_not_a_chroma_key(self) -> None:
        with self.assertRaisesRegex(chroma.ChromaKeyError, "not a chroma key"):
            chroma.measure_key(_frame((245, 245, 245), (200, 40, 40))[..., :3])

    def test_refuses_a_busy_border(self) -> None:
        noise = np.random.default_rng(7).integers(0, 256, (64, 64, 3), dtype=np.uint8)
        with self.assertRaisesRegex(chroma.ChromaKeyError, "not a solid background"):
            chroma.measure_key(noise)

    def test_leaves_pre_keyed_frames_unchanged(self) -> None:
        frame = _frame((0, 0, 0), (200, 40, 40))
        frame[..., 3] = 0
        frame[16:48, 16:48, 3] = 255
        keyed, key = chroma.key_image(Image.fromarray(frame))
        self.assertIsNone(key)
        np.testing.assert_array_equal(np.asarray(keyed), frame)


if __name__ == "__main__":
    unittest.main()
