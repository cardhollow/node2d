Screen Type behavior

Windowboxing (default): keeps the camera view at 1280x720 and fits it inside the physical screen. Extra space becomes black bars. The camera box stays 16:9.

Stretch: keeps the camera view at 1280x720 and stretches that canvas to the full physical screen. The entire canvas fills the screen, so the world can visually stretch when the screen ratio is different.

Crop: keeps the camera view at 1280x720 and scales it until the full physical screen is covered. The screen has no black bars, but the extra parts outside the camera frame are cropped.

Smart Camera: the camera itself adopts the physical screen aspect ratio. The world is not stretched and the camera view is expanded or narrowed instead. The editor's camera box also changes to show the Smart Camera view.

All modes use the camera transform, position, rotation, follow, offset, and scale as the source of the rendered world view. Screen-space input and UI use the same logical screen projection as the selected mode.
