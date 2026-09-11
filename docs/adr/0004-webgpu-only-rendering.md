# Require WebGPU for 3D rendering

Build the eventual React and Three.js renderer for standards-conforming desktop WebGPU implementations, use GPU compute for visible LOD generation, and fail clearly when required capabilities are unavailable rather than maintaining a WebGL fallback. This accepts WebGPU's evolving compatibility and cross-browser CI cost in exchange for a single rendering architecture targeting one million visible points at 60 fps.
