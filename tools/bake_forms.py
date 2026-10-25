"""bake_forms.py: bake 3D models (OBJ) into compact hologram forms.

Authoring tool only: never shipped (the deploy copies index.html, sw.js, css, js
and assets). It traces a model's sharp edges, keeps the longest ones, chains
them into polylines and writes them as base64 Int8 data into a JS module that
a world pack imports. The site itself stays build-free: the output is committed.

    python tools/bake_forms.py --assets "<Design Assets folder>" [--preview bake.png]

Standard library only (Pillow is optional, for --preview).
"""
import argparse
import base64
import json
import math
import pathlib
import re
import sys
from collections import defaultdict

EXTENT = 1.1          # forms are scaled so the largest |coordinate| is 1.1 (engine limit ~1.3)
MAX_POLYLINES = 140   # the low quality tier (N = 320) keeps at most 160 paths
MIN_EDGES = 40
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def load_obj(path):
    """Vertices and fan-triangulated faces of an OBJ file (0-based indices)."""
    verts, tris = [], []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == "v":
                verts.append(tuple(float(c) for c in p[1:4]))
            elif p[0] == "f":
                idx = [int(t.split("/")[0]) for t in p[1:]]
                idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                tris += [(idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1)]
    return verts, tris


def _weld(verts, tris):
    key, remap = {}, []
    for v in verts:
        remap.append(key.setdefault(tuple(round(c, 4) for c in v), len(key)))
    welded = [None] * len(key)
    for v, i in zip(verts, remap):
        welded[i] = v
    return welded, [tuple(remap[i] for i in t) for t in tris]


def _normal(a, b, c):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    length = math.sqrt(sum(x * x for x in n)) or 1.0
    return tuple(x / length for x in n)


def feature_edges(verts, tris, angle_deg):
    """Edges on open boundaries, or where the surface bends more than angle_deg."""
    verts, tris = _weld(verts, tris)
    faces = defaultdict(list)
    for t in tris:
        if len(set(t)) < 3:
            continue
        n = _normal(*(verts[i] for i in t))
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            faces[(min(a, b), max(a, b))].append(n)
    limit = math.cos(math.radians(angle_deg))
    out = []
    for e, ns in faces.items():
        if len(ns) != 2 or sum(x * y for x, y in zip(*ns)) < limit:
            out.append(e)
    return out


def _chain(edges):
    """Greedy walk through shared vertices; each polyline is a list of vertex ids (≤ 127)."""
    adj = defaultdict(list)
    for k, (a, b) in enumerate(edges):
        adj[a].append(k)
        adj[b].append(k)
    used = [False] * len(edges)

    def extend(line, at_end):
        while len(line) < 127:
            tip = line[-1] if at_end else line[0]
            nxt = next((k for k in adj[tip] if not used[k]), None)
            if nxt is None:
                return
            used[nxt] = True
            a, b = edges[nxt]
            other = b if a == tip else a
            if at_end:
                line.append(other)
            else:
                line.insert(0, other)

    polylines = []
    for k, (a, b) in enumerate(edges):
        if used[k]:
            continue
        used[k] = True
        line = [a, b]
        extend(line, True)
        extend(line, False)
        polylines.append(line)
    return polylines


def _rotate(p, deg):
    x, y, z = p
    rx, ry, rz = (math.radians(d) for d in deg)
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    x, y = x * math.cos(rz) - y * math.sin(rz), x * math.sin(rz) + y * math.cos(rz)
    return (x, y, z)


def bake(path, angle=50, edges=150, rotate=(0, 0, 0)):
    """Polylines of a model's longest feature edges, centred and scaled to EXTENT."""
    verts, tris = load_obj(path)
    welded, wtris = _weld(verts, tris)
    feat = feature_edges(welded, wtris, angle)
    feat.sort(key=lambda e: -math.dist(welded[e[0]], welded[e[1]]))
    lines = _chain(feat[:edges])
    pts = {i: _rotate(welded[i], rotate) for line in lines for i in line}
    lo = [min(p[d] for p in pts.values()) for d in range(3)]
    hi = [max(p[d] for p in pts.values()) for d in range(3)]
    mid = [(lo[d] + hi[d]) / 2 for d in range(3)]
    span = max(max(abs(p[d] - mid[d]) for p in pts.values()) for d in range(3)) or 1.0
    s = EXTENT / span
    return [[tuple((pts[i][d] - mid[d]) * s for d in range(3)) for i in line] for line in lines]


def bake_fit(path, angle=50, edges=150, rotate=(0, 0, 0), max_polylines=MAX_POLYLINES):
    """bake(), shrinking the edge budget by 10% until the polylines fit the engine's path limit."""
    while True:
        lines = bake(path, angle, edges, rotate)
        if len(lines) <= max_polylines or edges <= 1:
            return lines
        edges = max(1, int(edges * 0.9))


def encode(polylines):
    """Base64 of Int8: per polyline a count byte, then x,y,z per point (v ≈ q / 127 * 1.1)."""
    out = bytearray()
    for line in polylines:
        out.append(len(line))
        for p in line:
            for c in p:
                out.append(max(-127, min(127, round(c / EXTENT * 127))) & 0xFF)
    return base64.b64encode(bytes(out)).decode("ascii")


def decode(b64):
    raw = base64.b64decode(b64)
    q = lambda b: (b - 256 if b > 127 else b) / 127 * EXTENT  # noqa: E731
    polylines, i = [], 0
    while i < len(raw):
        n = raw[i]
        i += 1
        polylines.append([(q(raw[i + 3 * k]), q(raw[i + 3 * k + 1]), q(raw[i + 3 * k + 2])) for k in range(n)])
        i += 3 * n
    return polylines


def validate(form_id, polylines):
    """Raise ValueError unless the form is safe for the engine."""
    if not ID_RE.match(form_id):
        raise ValueError(f"{form_id}: id must be kebab-case")
    if len(polylines) > MAX_POLYLINES:
        raise ValueError(f"{form_id}: {len(polylines)} polylines > {MAX_POLYLINES}")
    coords = [c for line in polylines for p in line for c in p]
    if any(not math.isfinite(c) for c in coords):
        raise ValueError(f"{form_id}: non-finite coordinate")
    if coords and max(abs(c) for c in coords) > 1.3:
        raise ValueError(f"{form_id}: extent > 1.3")
    n_edges = sum(len(line) - 1 for line in polylines)
    if n_edges < MIN_EDGES and not form_id.startswith("test-"):
        raise ValueError(f"{form_id}: only {n_edges} edges (< {MIN_EDGES})")


def preview(forms, out):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("Pillow not installed: skipping --preview")
        return
    cell, cols = 200, 5
    rows = (len(forms) + cols - 1) // cols
    img = Image.new("RGB", (cols * cell, rows * cell), (11, 10, 31))
    d = ImageDraw.Draw(img)
    for n, (form_id, lines, upright) in enumerate(forms):
        ox, oy = (n % cols) * cell + cell // 2, (n // cols) * cell + cell // 2 - 10
        ay, ax = 0.7, 0.18 if upright else 0.45
        for line in lines:
            pts = []
            for x, y, z in line:
                x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
                y = y * math.cos(ax) - z * math.sin(ax)
                pts.append((ox + x * 70, oy - y * 70))
            d.line(pts, fill=(95, 225, 214), width=1)
        d.text((ox - 90, oy + 82), form_id, fill=(255, 180, 84))
    img.save(out)
    print("preview:", out)


def main():
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--assets", required=True, help="folder the manifest's src paths are relative to")
    ap.add_argument("--manifest", default=str(here / "forms-manifest.json"))
    ap.add_argument("--out", default=str(here.parent / "js" / "worlds" / "deepfield-baked.js"))
    ap.add_argument("--preview", help="optional PNG contact sheet (needs Pillow)")
    args = ap.parse_args()

    entries = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    seen, baked, shown = set(), [], []
    for e in entries:
        if e["id"] in seen:
            sys.exit(f"duplicate id {e['id']}")
        seen.add(e["id"])
        lines = bake_fit(pathlib.Path(args.assets) / e["src"], e.get("angle", 50), e.get("edges", 150), e.get("rotate", [0, 0, 0]))
        lines = decode(encode(lines))  # validate exactly what ships
        try:
            validate(e["id"], lines)
        except ValueError as err:
            sys.exit(f"FAIL {err}")
        print(f"ok  {e['id']:<22} {len(lines):>3} polylines, {sum(len(l) - 1 for l in lines):>3} edges")
        baked.append({"id": e["id"], "label": e["label"], "credit": e["credit"], "upright": bool(e.get("upright")), "data": encode(lines)})
        shown.append((e["id"], lines, bool(e.get("upright"))))

    body = ",\n".join("  " + json.dumps(b, separators=(", ", ": ")) for b in baked)
    pathlib.Path(args.out).write_text(
        "// GENERATED by tools/bake_forms.py from tools/forms-manifest.json; do not edit by hand.\n"
        "// Hologram forms traced from CC0 models by Quaternius (quaternius.com).\n"
        f"export const BAKED = [\n{body},\n];\n", encoding="utf-8", newline="\n")
    print("wrote", args.out, pathlib.Path(args.out).stat().st_size, "bytes")
    if args.preview:
        preview(shown, args.preview)


if __name__ == "__main__":
    main()
