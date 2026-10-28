# Escenas originales de demostración

Tres imágenes creadas con la herramienta integrada ImageGen el 19 de octubre de 2026 y guardadas en este proyecto. Los MP4 son bucles silenciosos de cinco segundos con un movimiento de cámara sutil, producidos localmente con FFmpeg. No son resultados del endpoint de video fal.ai.

| Archivos | Escena |
| --- | --- |
| `moon-garden.jpg`, `moon-garden.mp4` | Jardín lunar y luna rosa |
| `jellyfish.jpg`, `jellyfish.mp4` | Medusas bioluminiscentes sobre dunas |
| `desert.jpg`, `desert.mp4` | Arquitectura flotante y sol terracota |

Prompts usados (sin referencias de terceros):

1. “A breathtaking cinematic photoreal 16:9 landscape: an impossible lunar botanical garden at blue hour, a massive luminous pale pink moon low in the center of the midnight-purple sky, a reflective winding stream leading toward the moon, dense wildflowers and elegant luminous lavender and blush pink flowering trees, dark mountains beyond. Ethereal clouds and gentle atmospheric mist, intricate organic detail, deeply rich midnight indigo shadows, pale lavender silvery highlights, small coral botanical accents. Sophisticated dream cinema, surreal but believable. Wide establishing composition, horizon upper-middle, near flowers framing the foreground, remarkable depth. No people, no text, no UI, no logos, no watermark.”
2. “A tiny lone astronaut walking through a midnight desert of undulating violet dunes, while magnificent translucent luminous jellyfish float gently overhead like hot air balloons. One monumental jellyfish in foreground left, many smaller in the deep space background. Dark indigo sky, teal and lavender bioluminescence, hints of pale coral, moody film grain, softly glowing tentacles, sophisticated cinema lighting, ethereal scale, exquisite detail. Realistic materials, dreamlike scene, no brands or text. Single widescreen cinematic 16:9 photographic surreal concept art landscape.”
3. “A perfectly circular immense terracotta orange sun hovering over a tranquil sea of sand dunes, a long horizontal floating brutalist pale ivory architectural ring with a small tranquil cobalt pool above the sand, tiny cypress trees, warm dusty rose twilight sky, sculptural dunes foreground. Quiet art-house cinema, sophisticated editorial texture, visually arresting architectural dreamscape. Restrained palette amber orange, terracotta and pink with subtle indigo shadows. Detailed realistic materials and extraordinary atmosphere. No people, text, logos, labels, watermark or UI. Single widescreen cinematic landscape 16:9.”

Para reconstruir los MP4 a partir de los JPG incluidos, ejecutar `scripts/create-demo-media.py` con Python, Pillow e imageio-ffmpeg instalados. No es necesario para instalar o abrir la aplicación.
