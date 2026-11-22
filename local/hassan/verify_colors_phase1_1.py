import os
from PIL import Image

WORKSPACE = "/Users/zyad/Projects/hassan-ragab-salon"
OUTPUT_DIR = os.path.join(WORKSPACE, ".local/hassan/visual-qa-phase1-1")

# Legacy Omar Fahim petroleum blues to ensure are NOT present
# #24353E -> (36, 53, 62)
# #2B3C45 -> (43, 60, 69)
# #62727A -> (98, 114, 122)
FORBIDDEN_COLORS = [
    (36, 53, 62), # #24353E
    (43, 60, 69), # #2B3C45
    (98, 114, 122) # #62727A
]

def check_image(img_path):
    if not os.path.exists(img_path):
        return f"File missing: {img_path}"
    
    img = Image.open(img_path).convert('RGB')
    width, height = img.size
    pixels = img.load()
    
    # Check for forbidden colors with a small tolerance
    forbidden_matches = {fc: 0 for fc in FORBIDDEN_COLORS}
    
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            for fc in FORBIDDEN_COLORS:
                if abs(r - fc[0]) <= 2 and abs(g - fc[1]) <= 2 and abs(b - fc[2]) <= 2:
                    forbidden_matches[fc] += 1
                    
    total_forbidden = sum(forbidden_matches.values())
    return {
        "file": os.path.basename(img_path),
        "dimensions": f"{width}x{height}",
        "forbidden_pixel_count": total_forbidden,
        "details": forbidden_matches
    }

def main():
    print("=== COLOR VERIFICATION AUDIT ===")
    images = [
        "admin-02-dashboard.png",
        "admin-02-kpi-detail.png",
        "admin-12-settings-accounts.png",
        "admin-08-treasury.png",
        "mini-03-cashier-main.png",
        "mini-08-attendance.png",
        "mini-08-attendance-card-detail.png"
    ]
    for img_name in images:
        path = os.path.join(OUTPUT_DIR, img_name)
        res = check_image(path)
        print(res)

if __name__ == '__main__':
    main()
