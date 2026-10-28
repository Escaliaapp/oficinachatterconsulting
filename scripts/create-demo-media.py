"""Build silent 5s demo loops from original generated artwork; no remote generation."""
from pathlib import Path
import subprocess
import imageio_ffmpeg
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public' / 'media'
out.mkdir(parents=True, exist_ok=True)
assets = ['moon-garden', 'jellyfish', 'desert']
for name in assets:
    with Image.open(out / f'{name}.jpg') as img:
        img.verify()
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loop', '1', '-i', str(out / f'{name}.jpg'),
        '-vf', "scale=1920:-1,zoompan=z='1.02+0.012*sin(on*2*PI/120)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=120:s=1280x720:fps=24",
        '-t', '5', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(out / f'{name}.mp4')], check=True, capture_output=True)
    print(f'Created {name}.mp4 from included poster')
