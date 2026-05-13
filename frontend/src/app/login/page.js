"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("login");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      if (mode === "register") {
        await apiFetch("/api/register", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        setMode("login");
        setError("Registered! Please log in.");
      } else {
        const data = await apiFetch("/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        localStorage.setItem("token", data.token);
        router.push("/");
      }
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", padding: 40, borderRadius: 12, width: 360, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
        <h2 style={{ textAlign: "center", marginTop: 0, color: "#1a1a2e" }}>
          {mode === "login" ? "Login" : "Register"}
        </h2>

        {error && <p style={{ color: mode === "register" && error.includes("Registered") ? "green" : "red", fontSize: 13 }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <button type="submit" style={{ ...btnStyle, width: "100%" }}>
            {mode === "login" ? "Login" : "Register"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
          {mode === "login" ? "No account? " : "Have an account? "}
          <span
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            style={{ color: "#3498db", cursor: "pointer" }}
          >
            {mode === "login" ? "Register" : "Login"}
          </span>
        </p>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  marginBottom: 12,
  border: "1px solid #ddd",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const btnStyle = {
  background: "#1a1a2e",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 0",
  cursor: "pointer",
  fontSize: 15,
};
