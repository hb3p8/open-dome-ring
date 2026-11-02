# Open Dome Ring

A standalone WebGPU ring editor with spline controls for asymmetric shoulders,
a slim middle and rounded tips. The interface fills the window with a metal
preview and the spline panel.

The ring lies in XY, with its hole axis along Z. Horizontal orbit drags rotate
around Z, following the ring plane; vertical drags tilt the view. The same
orientation is included in OBJ and STL exports. Spline deformation operates in
the base mesh's local frame, including its transformed smooth normals.

## Run locally

Install Node.js 24 LTS, then run:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5179/>. WebGPU and hardware acceleration are required.

```sh
npm test
npm run build
npm run preview
```

The production preview is at <http://127.0.0.1:4179/>; publish the `dist/`
directory. All source files and assets needed for this project are included.
The only runtime package is Three.js; Vite is the build tool. There is no field
evaluator, mesh extraction engine, external source checkout or server backend.

## Edit and export

- Drag spline knots to change height and position along the ring.
- Drag a 3D handle along the highlighted section to adjust height.
- Double-click the graph to add a knot; Delete removes an interior knot.
- Each side is independent, with optional symmetry linking per parameter.
- Profiles stay in this browser. Use JSON to transfer edits between origins.
- OBJ includes smooth vertex normals. STL includes the current triangle mesh.
- Coordinates and export dimensions are in millimetres. Reset restores the
  original base surface.

## Publish to GitHub Pages

Create an empty GitHub repository, add it as `origin`, and push `main`.
In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
Run **Deploy Open Dome Ring** in the Actions tab, or push another commit.
The workflow tests, builds and deploys this project from the repository root.
Relative URLs support any repository name without changing the base path.

The included GLB and envelope metadata are matched by SHA-256 during the build.
The display LUT and Three.js licence notice are in `public/`.
