import { useState } from "react";
import { fetchHealth } from "./api";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

export const App = () => {
  const [message, setMessage] = useState("APIヘルスチェック未実行");

  const onCheckHealth = async () => {
    try {
      const health = await fetchHealth(apiBaseUrl);
      setMessage(`${health.service}: ${health.ok ? "ok" : "ng"} (${health.env})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      setMessage(`error: ${errorMessage}`);
    }
  };

  return (
    <main
      style={{
        margin: "2rem auto",
        maxWidth: "56rem",
        fontFamily: "sans-serif",
        padding: "0 1rem",
      }}
    >
      <h1>Future Diary</h1>
      <p>未来日記の初期化プロジェクトです。</p>
      <button onClick={() => void onCheckHealth()} type="button">
        API health を確認
      </button>
      <p>{message}</p>
    </main>
  );
};
