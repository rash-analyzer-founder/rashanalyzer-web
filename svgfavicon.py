from PIL import Image, ImageDraw, ImageOps

# 1. Load your original logo (Make sure it's in the same folder!)
input_file = "logo.png" 
output_ico = "favicon.ico"
output_png = "favicon.png"

def make_sharp_circle_favicon(file_path):
    # Open and convert to RGBA for transparency
    img = Image.open(file_path).convert("RGBA")
    
    # Use a large base size for a smooth circle (1024x1024)
    size = (1024, 1024)
    img = img.resize(size, Image.Resampling.LANCZOS)

    # Create the circular mask
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0) + size, fill=255)

    # Apply mask
    output = ImageOps.fit(img, mask.size, centering=(0.5, 0.5))
    output.putalpha(mask)

    # SAVE AS ICO (Multi-size for different browser zooms)
    # This keeps it sharp whether the tab is small or the user zooms in
    icon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    output.save(output_ico, sizes=icon_sizes, bitmap_format="png")

    # SAVE AS PNG (Sharp 32x32 for modern browsers)
    final_png = output.resize((32, 32), Image.Resampling.LANCZOS)
    final_png.save(output_png)

    print(f"✅ Mission Accomplished! Circular, sharp icons created for Rashdan's Lab.")

make_sharp_circle_favicon(input_file)