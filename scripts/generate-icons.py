from pathlib import Path
import json
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
icons = root / "src-tauri/icons"
source = Image.open(icons / "icon_new.png").convert("RGBA")
background = Image.new("RGBA", source.size, "white")
background.alpha_composite(source)
background.convert("RGB").save(root / "app-icon.png")

with tempfile.TemporaryDirectory() as directory:
    generated = Path(directory)
    subprocess.run([
        str(root / "node_modules/.bin/tauri"), "icon",
        str(root / "app-icon.png"), "--output", directory,
    ], check=True)
    for path in generated.iterdir():
        destination = icons / path.name
        if path.is_dir():
            shutil.copytree(path, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(path, destination)

    mac = Image.new("RGBA", (1024, 1024))
    mask = Image.new("L", (824, 824))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 823, 823), radius=180, fill=255)
    tile = background.resize((824, 824), Image.Resampling.LANCZOS)
    mac.paste(tile, (100, 100), mask)
    mac.save(icons / "icon.icns")

catalog = root / "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
if catalog.exists():
    for entry in json.loads((catalog / "Contents.json").read_text())["images"]:
        filename = entry.get("filename")
        if filename:
            shutil.copy2(icons / "ios" / filename, catalog / filename)
