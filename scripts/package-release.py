"""Build a reproducible source + static app ZIP; no credentials or dependencies."""

from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "release"
OUTPUT.mkdir(exist_ok=True)

files = [ROOT / name for name in [
    "README.md", "package.json", "package-lock.json", "index.html",
    "tsconfig.json", "vite.config.ts", "playwright.config.ts",
    "start-windows.cmd", ".gitignore", ".gitattributes",
]]
for directory in ["src", "public", "docs", "dist", "scripts"]:
    files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())
files.extend((ROOT / "tests").glob("*.ts"))

assert (ROOT / "dist/index.html").is_file(), "Run npm run build first."
assert (ROOT / "dist/licenses/Apache-2.0.txt").is_file(), "Published license is missing."
target = OUTPUT / "aura-tv-windows.zip"
with ZipFile(target, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(set(files)):
        assert path.is_file(), f"Required file missing: {path.name}"
        relative = path.relative_to(ROOT)
        assert not any(part in {".git", "node_modules", ".media", "__pycache__"} for part in relative.parts)
        assert not path.name.startswith(".env"), "Environment files must not be published."
        entry = ZipInfo(str(Path("aura-tv") / relative), date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, path.read_bytes())

with ZipFile(target) as archive:
    assert archive.testzip() is None, "Archive integrity check failed."
digest = sha256(target.read_bytes()).hexdigest()
(OUTPUT / "SHA256SUMS").write_text(f"{digest}  {target.name}\n")
print(f"Packaged {len(set(files))} files; {target.stat().st_size:,} bytes; SHA-256 {digest}")
