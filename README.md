# Bob's App

Bob's App is a public index for product field files, working applications, and project case studies. The homepage uses a compact project index with one large active viewer so visitors can move quickly between the work and its supporting story.

## Local preview

Serve the repository root with any static file server. For example:

```powershell
npx serve .
```

## Structure

- `index.html` contains the portfolio shell and project index.
- `app.js` contains the initial project data and selection behavior.
- `project.html` and `demo.html` provide working destinations while full field files and applications are integrated.
- `styles.css` contains the shared visual and responsive system.

## Deployment

Vercel serves the static files from the repository root. Pushes to `main` deploy automatically through the connected GitHub repository.
