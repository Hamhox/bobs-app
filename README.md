# Bob's App

Bob's App is a public directory for product field files, working applications, and project case studies. The homepage provides six direct entry points, while `/portfolio` presents the complete guided project console.

## Local preview

Serve the repository root with any static file server. For example:

```powershell
npx serve .
```

## Structure

- `index.html` contains the public site directory.
- `portfolio.html` contains the guided portfolio shell and project viewer.
- `artifacts.html` contains the working archive index.
- `projects.js` is the single data source for all six project entries.
- `app.js` renders the project index, manages accessible selection, and keeps project state synchronized with browser history.
- `project.html` and `demo.html` provide working destinations while full field files and applications are integrated.
- `styles.css` contains the shared visual and responsive system.

## Deployment

Vercel serves the static files from the repository root. Pushes to `main` deploy automatically through the connected GitHub repository.
