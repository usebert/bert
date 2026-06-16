import "dotenv/config";

const port = process.env.PORT || "8787";
let frontend = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
if (frontend.endsWith("/")) {
  frontend = frontend.slice(0, -1);
}

console.log(`
Sign in to Google for the API (start it first: npm run server)

  Direct (API):     http://127.0.0.1:${port}/auth/google/login
  Via Vite proxy:   ${frontend}/auth/google/login   (needs npm run dev + server)

After success, you should have .sessions/google-session.json — then invite "Complete onboarding" works.
`);
