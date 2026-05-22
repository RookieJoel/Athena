import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import mongoose, { Schema, Document, model } from "mongoose";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })
);
app.use(express.json({ limit: "10kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Types ---
interface IUser extends Document {
  username: string;
  password: string;
}

interface INote extends Document {
  userId: string;
  title: string;
  content: string;
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
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = model<IUser>("User", userSchema);

const noteSchema = new Schema<INote>({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  content: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});
const Note = model<INote>("Note", noteSchema);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

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
app.post("/api/register", authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body as { username: unknown; password: unknown };

    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    if (username.length < 3 || username.length > 30 || password.length < 8) {
      res.status(400).json({ error: "Username must be 3-30 chars, password at least 8 chars" });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    res.json({ message: "Registered", id: user._id });
  } catch {
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body as { username: unknown; password: unknown };

    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const user = await User.findOne({ username });

    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = jwt.sign(
      { id: user._id.toString(), username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

// --- Notes Routes ---
app.get("/api/notes", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const notes = await Note.find({ userId: req.user!.id });
    res.json(notes);
  } catch {
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

app.post("/api/notes", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, content } = req.body as { title: unknown; content: unknown };

    if (typeof title !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    if (title.length > 200 || content.length > 10000) {
      res.status(400).json({ error: "Title max 200 chars, content max 10000 chars" });
      return;
    }

    const note = await Note.create({ userId: req.user!.id, title, content });
    res.json(note);
  } catch {
    res.status(500).json({ error: "Failed to create note" });
  }
});

app.delete("/api/notes/:id", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ error: "Failed to delete note" });
  }
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
