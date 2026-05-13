"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export default function Home() {
  const router = useRouter();
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      router.push("/login");
      return;
    }
    loadNotes();
  }, []);

  async function loadNotes() {
    try {
      const data = await apiFetch("/api/notes");
      setNotes(data);
    } catch (e) {
      setError(e.message);
    }
  }

  async function addNote(e) {
    e.preventDefault();
    try {
      await apiFetch("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      setTitle("");
      setContent("");
      loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteNote(id) {
    try {
      await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
      loadNotes();
    } catch (e) {
      setError(e.message);
    }
  }

  function logout() {
    localStorage.removeItem("token");
    router.push("/login");
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ color: "#1a1a2e" }}>📝 Athena Notes</h1>
        <button onClick={logout} style={btnStyle("#e74c3c")}>Logout</button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <form onSubmit={addNote} style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>New Note</h3>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={inputStyle}
        />
        <textarea
          placeholder="Content (HTML allowed)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <button type="submit" style={btnStyle("#2ecc71")}>Add Note</button>
      </form>

      <div>
        {notes.map((n) => (
          <div key={n._id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{n.title}</strong>
              <button onClick={() => deleteNote(n._id)} style={btnStyle("#e74c3c")}>✕</button>
            </div>
            {/* VULN: dangerouslySetInnerHTML renders stored XSS payload */}
            <div dangerouslySetInnerHTML={{ __html: n.content }} style={{ marginTop: 8 }} />
            <small style={{ color: "#888" }}>{new Date(n.createdAt).toLocaleString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  marginBottom: 12,
  border: "1px solid #ddd",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const btnStyle = (bg) => ({
  background: bg,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  cursor: "pointer",
  fontSize: 14,
});
