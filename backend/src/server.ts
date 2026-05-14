import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import mongoose, { Schema, Document, model } from "mongoose";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();

// VULN: wildcard CORS — accepts requests from any origin
app.use(cors());
app.use(express.json());

// --- Types ---
interface IUser extends Document {
  username: string;
  password: string;
}

interface INote extends Document {
  userId: string;
  title: string;
  content: string; // VULN: raw HTML stored, no sanitization → stored XSS
  createdAt: Date;
}

interface JwtPayload {
  id: string;
  username: string;
}

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// --- Models ---
const userSchema = new Schema<IUser>({
  username: { type: String, required: true },
  password: { type: String, required: true },
});
const User = model<IUser>("User", userSchema);

const noteSchema = new Schema<INote>({
  userId: { type: String, required: true },
  title: { type: String, required: true },
  content: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});
const Note = model<INote>("Note", noteSchema);

// VULN: hardcoded fallback secret
const JWT_SECRET = process.env.JWT_SECRET ?? "secret";

// --- Middleware ---
const auth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ error: "No token" });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- Auth Routes ---
app.post("/api/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body as { username: string; password: string };
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    res.json({ message: "Registered", id: user._id });
  } catch (err) {
    const e = err as Error;
    // VULN: leaks full stack trace to client
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.post("/api/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body as { username: unknown; password: string };

    // VULN: NoSQL injection — no type check on username
    // attacker sends: { "username": { "$gt": "" }, "password": "x" }
    const user = await User.findOne({ username });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      res.status(401).json({ error: "Wrong password" });
      return;
    }

    const token = jwt.sign(
      { id: user._id.toString(), username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token });
  } catch (err) {
    const e = err as Error;
    // VULN: leaks stack trace
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// --- Notes Routes ---
app.get("/api/notes", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  const notes = await Note.find({ userId: req.user!.id });
  res.json(notes);
});

app.post("/api/notes", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content } = req.body as { title: string; content: string };
    // VULN: content stored as raw HTML
    const note = await Note.create({ userId: req.user!.id, title, content });
    res.json(note);
  } catch (err) {
    const e = err as Error;
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.delete("/api/notes/:id", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // VULN: no ownership check — any authed user can delete any note
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    const e = err as Error;
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// VULN: unauthenticated debug endpoint
app.get("/api/debug/users", async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find({}, "username _id");
  res.json(users);
});

// --- Health ---
app.get("/health", (_req: Request, res: Response): void => {
  res.status(200).json({ status: "ok" });
});

// --- Start ---
mongoose
  .connect(process.env.MONGO_URI ?? "")
  .then(() => {
    console.log("MongoDB connected");
    app.listen(Number(process.env.PORT) || 4000, () =>
      console.log(`Backend running on port ${process.env.PORT ?? 4000}`)
    );
  })
  .catch((err: Error) => console.error("DB connection error:", err.message));
