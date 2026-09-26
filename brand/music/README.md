# Music

Drop **licensed** music here (mp3 / wav / m4a). Audio files in this folder are git-ignored.

Use a track in a spec by path, or give it a name in the brand file:

```yaml
# brand/<brand>/brand.yaml
music:
  bed: music/your_track.mp3

# spec
audio:
  music: {file: bed, volume: -6, fade_out: 1.5}       # or file: music/your_track.mp3
```

Only use music you have the rights to use on social platforms (your own, royalty-free with a
licence that covers social/commercial use, or the platform's own library added at upload).

No track? Every spec can generate an original bed (synthesised, no licence needed):

```yaml
audio:
  music: {generate: {bpm: 120, key: D, drop: 3.0, resolve: 27.0}, volume: -4}
```

or save one: `./vtk music --duration 30 --bpm 120 --key D --drop 3` -> `brand/music/generated/`.
