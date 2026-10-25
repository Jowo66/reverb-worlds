"""Unit tests for tools/bake_forms.py (offline OBJ → Int8 polyline baker).

Run: python -m unittest tests/test_bake_forms.py -v
"""
import math
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import bake_forms as B  # noqa: E402

CUBE = """v -1 -1 -1
v 1 -1 -1
v 1 1 -1
v -1 1 -1
v -1 -1 1
v 1 -1 1
v 1 1 1
v -1 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
"""


def cube_path():
    fd, path = tempfile.mkstemp(suffix=".obj")
    with os.fdopen(fd, "w") as f:
        f.write(CUBE)
    return path


def vox_path(voxels, size=(4, 4, 4)):
    """A minimal MagicaVoxel file (MAIN > SIZE, XYZI) holding the given voxels."""
    import struct

    def chunk(cid, content, children=b""):
        return cid + struct.pack("<ii", len(content), len(children)) + content + children

    body = chunk(b"SIZE", struct.pack("<iii", *size))
    body += chunk(b"XYZI", struct.pack("<i", len(voxels)) + b"".join(bytes((x, y, z, 1)) for x, y, z in voxels))
    fd, path = tempfile.mkstemp(suffix=".vox")
    with os.fdopen(fd, "wb") as f:
        f.write(b"VOX " + struct.pack("<i", 150) + chunk(b"MAIN", b"", body))
    return path


class VoxTest(unittest.TestCase):
    def tearDown(self):
        os.remove(self.path)

    def test_load_vox(self):
        self.path = vox_path([(0, 0, 0), (1, 2, 3)])
        self.assertEqual(B.load_vox(self.path), {(0, 0, 0), (1, 2, 3)})

    def test_single_voxel_has_12_edges(self):
        self.path = vox_path([(1, 1, 1)])
        verts, edges = B.voxel_edges(B.load_vox(self.path))
        self.assertEqual(len(edges), 12)

    def test_bar_merges_collinear_edges(self):
        # a 3x1x1 bar: 12 edges, no seams where the voxels meet; 4 of them span the full length
        self.path = vox_path([(0, 0, 0), (1, 0, 0), (2, 0, 0)])
        verts, edges = B.voxel_edges(B.load_vox(self.path))
        self.assertEqual(len(edges), 12)
        self.assertEqual(sorted(round(math.dist(verts[a], verts[b])) for a, b in edges), [1] * 8 + [3] * 4)

    def test_coarsen_keeps_majority_blocks(self):
        self.path = vox_path([])
        full = {(x, y, z) for x in range(2) for y in range(2) for z in range(2)}  # one solid 2x2x2 block
        half = {(2, 0, 0), (3, 0, 0), (2, 1, 0), (3, 1, 0)}                     # 4 of 8 cells: kept
        speck = {(4, 0, 0)}                                                     # 1 of 8 cells: dropped
        self.assertEqual(B.coarsen(full | half | speck, 2), {(0, 0, 0), (1, 0, 0)})
        self.assertEqual(B.coarsen(full, 1), full)

    def test_bake_vox_coarsen(self):
        cells = [(x, y, z) for x in range(6) for y in range(2) for z in range(2)]  # a 6x2x2 bar
        self.path = vox_path(cells, size=(8, 8, 8))
        self.assertEqual(sum(len(p) - 1 for p in B.bake(self.path, block=2)), 12)

    def test_bake_vox(self):
        self.path = vox_path([(0, 0, 0), (1, 0, 0), (2, 0, 0)])
        polys = B.bake(self.path)
        ext = max(abs(c) for poly in polys for p in poly for c in p)
        self.assertAlmostEqual(ext, 1.1, places=6)
        self.assertEqual(sum(len(p) - 1 for p in polys), 12)


class BakeFormsTest(unittest.TestCase):
    def setUp(self):
        self.path = cube_path()

    def tearDown(self):
        os.remove(self.path)

    def test_cube_feature_edges(self):
        verts, tris = B.load_obj(self.path)
        self.assertEqual(len(tris), 12)
        self.assertEqual(len(B.feature_edges(verts, tris, 50)), 12)  # diagonals lie on flat faces

    def test_bake_extent(self):
        polys = B.bake(self.path)
        ext = max(abs(c) for poly in polys for p in poly for c in p)
        self.assertAlmostEqual(ext, 1.1, places=6)

    def test_roundtrip(self):
        polys = B.bake(self.path)
        back = B.decode(B.encode(polys))
        self.assertEqual([len(p) for p in back], [len(p) for p in polys])
        for pa, pb in zip(polys, back):
            for a, b in zip(pa, pb):
                for x, y in zip(a, b):
                    self.assertLessEqual(abs(x - y), 1.1 / 127 + 1e-9)

    def test_chaining(self):
        self.assertLessEqual(len(B.bake(self.path)), 6)

    def test_bake_fit_shrinks_edge_budget(self):
        polys = B.bake_fit(self.path, edges=12, max_polylines=2)
        self.assertLessEqual(len(polys), 2)
        self.assertGreaterEqual(sum(len(p) - 1 for p in polys), 1)

    def test_validate_rejects(self):
        polys = B.bake(self.path)
        B.validate("test-cube", polys)  # small test forms are exempt from the 40-edge minimum
        with self.assertRaises(ValueError):
            B.validate("Bad Id", polys)
        with self.assertRaises(ValueError):
            B.validate("test-many", [[(0, 0, 0), (0.1, 0, 0)]] * 141)
        with self.assertRaises(ValueError):
            B.validate("test-nan", [[(math.nan, 0, 0), (0.1, 0, 0)]])
        with self.assertRaises(ValueError):
            B.validate("ship-tiny", polys)  # 12 edges < 40


if __name__ == "__main__":
    unittest.main()
