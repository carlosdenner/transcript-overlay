"""
Generate a custom icon for Transcript Overlay app.
Creates a modern, minimal icon with a speech bubble and language symbol.
High-resolution version with supersampling for crisp edges.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

def create_icon(size=1024):
    """Create a modern transcript overlay icon with supersampling."""
    # Supersample at 4x for anti-aliasing
    ss_factor = 4
    ss_size = size * ss_factor
    
    # Create image with transparent background at high res
    img = Image.new('RGBA', (ss_size, ss_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Colors
    bg_color = (24, 24, 28, 255)  # Darker, richer background
    accent_color = (99, 102, 241, 255)  # Indigo/purple accent
    accent_dark = (79, 82, 191, 255)  # Darker accent for depth
    text_color = (255, 255, 255, 255)  # White
    secondary_color = (251, 191, 36, 255)  # Yellow/gold for translation
    secondary_dark = (220, 165, 20, 255)  # Darker gold
    
    # Padding and dimensions (at supersampled size)
    padding = ss_size // 10
    corner_radius = ss_size // 7
    
    # Draw shadow for depth
    shadow_offset = ss_size // 40
    draw.rounded_rectangle(
        [padding + shadow_offset, padding + shadow_offset, 
         ss_size - padding + shadow_offset, ss_size - padding + shadow_offset],
        radius=corner_radius,
        fill=(0, 0, 0, 80)
    )
    
    # Draw rounded rectangle background
    draw.rounded_rectangle(
        [padding, padding, ss_size - padding, ss_size - padding],
        radius=corner_radius,
        fill=bg_color
    )
    
    # Draw speech bubble shape
    bubble_left = padding + ss_size // 7
    bubble_top = padding + ss_size // 6
    bubble_right = ss_size - padding - ss_size // 7
    bubble_bottom = ss_size - padding - ss_size // 4
    bubble_radius = ss_size // 12
    
    # Bubble shadow
    draw.rounded_rectangle(
        [bubble_left + shadow_offset//2, bubble_top + shadow_offset//2, 
         bubble_right + shadow_offset//2, bubble_bottom + shadow_offset//2],
        radius=bubble_radius,
        fill=(0, 0, 0, 60)
    )
    
    # Main bubble
    draw.rounded_rectangle(
        [bubble_left, bubble_top, bubble_right, bubble_bottom],
        radius=bubble_radius,
        fill=accent_color
    )
    
    # Bubble tail (triangle pointing down-left)
    tail_points = [
        (bubble_left + ss_size // 8, bubble_bottom - ss_size // 25),
        (bubble_left + ss_size // 14, bubble_bottom + ss_size // 9),
        (bubble_left + ss_size // 5, bubble_bottom - ss_size // 25)
    ]
    draw.polygon(tail_points, fill=accent_color)
    
    # Draw text lines in the bubble (representing transcript)
    line_y = bubble_top + ss_size // 12
    line_left = bubble_left + ss_size // 14
    line_right = bubble_right - ss_size // 14
    line_height = ss_size // 32
    line_spacing = ss_size // 14
    
    for i in range(3):
        # Vary line lengths
        length_factor = [1.0, 0.7, 0.45][i]
        actual_right = line_left + (line_right - line_left) * length_factor
        draw.rounded_rectangle(
            [line_left, line_y, actual_right, line_y + line_height],
            radius=line_height // 2,
            fill=text_color
        )
        line_y += line_spacing
    
    # Draw translation indicator (small yellow badge in corner)
    badge_size = ss_size // 5
    badge_x = bubble_right - badge_size // 3
    badge_y = bubble_top - badge_size // 4
    
    # Badge shadow
    draw.ellipse(
        [badge_x - badge_size // 2 + shadow_offset//2, badge_y - badge_size // 2 + shadow_offset//2,
         badge_x + badge_size // 2 + shadow_offset//2, badge_y + badge_size // 2 + shadow_offset//2],
        fill=(0, 0, 0, 80)
    )
    
    # Badge
    draw.ellipse(
        [badge_x - badge_size // 2, badge_y - badge_size // 2,
         badge_x + badge_size // 2, badge_y + badge_size // 2],
        fill=secondary_color
    )
    
    # Try to load a font for the translation symbol
    font = None
    font_size = badge_size // 2
    try:
        # Try common Windows fonts that have CJK characters
        for font_path in [
            "C:/Windows/Fonts/msyh.ttc",  # Microsoft YaHei
            "C:/Windows/Fonts/simsun.ttc",  # SimSun
            "C:/Windows/Fonts/msjh.ttc",  # Microsoft JhengHei
            "C:/Windows/Fonts/yugothm.ttc",  # Yu Gothic
            "C:/Windows/Fonts/arial.ttf",  # Fallback
        ]:
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
                break
    except:
        pass
    
    # Draw "文" character in the badge
    if font:
        draw.text(
            (badge_x, badge_y),
            "文",
            fill=bg_color,
            font=font,
            anchor="mm"
        )
    else:
        # Fallback: draw "T" for Translation
        try:
            arial = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", badge_size // 2)
            draw.text((badge_x, badge_y), "T", fill=bg_color, font=arial, anchor="mm")
        except:
            pass
    
    # Downsample with high-quality LANCZOS filter
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    
    return img


def save_icons(base_img, output_dir):
    """Save icon in all required sizes with high quality."""
    sizes = {
        'icon.png': 512,
        '32x32.png': 32,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'Square30x30Logo.png': 30,
        'Square44x44Logo.png': 44,
        'Square71x71Logo.png': 71,
        'Square89x89Logo.png': 89,
        'Square107x107Logo.png': 107,
        'Square142x142Logo.png': 142,
        'Square150x150Logo.png': 150,
        'Square284x284Logo.png': 284,
        'Square310x310Logo.png': 310,
        'StoreLogo.png': 50,
    }
    
    for filename, size in sizes.items():
        resized = base_img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(os.path.join(output_dir, filename), 'PNG', optimize=True)
        print(f"Created {filename}")
    
    # Create ICO file (Windows) with more sizes for crisp display
    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), 
                 (64, 64), (96, 96), (128, 128), (256, 256)]
    ico_images = [base_img.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
    ico_images[0].save(
        os.path.join(output_dir, 'icon.ico'),
        format='ICO',
        sizes=ico_sizes
    )
    print("Created icon.ico (with 10 sizes up to 256x256)")
    
    # Create ICNS file (macOS) - just save the largest PNG, tauri will handle it
    base_img.resize((512, 512), Image.Resampling.LANCZOS).save(
        os.path.join(output_dir, 'icon.icns.png')
    )
    print("Created icon.icns.png (rename to .icns manually or use iconutil on macOS)")


if __name__ == '__main__':
    output_dir = 'src-tauri/icons'
    print(f"Creating icons in {output_dir}...")
    
    # Generate the icon
    icon = create_icon(1024)
    
    # Save all sizes
    save_icons(icon, output_dir)
    
    print("\nDone! Icons created successfully.")
