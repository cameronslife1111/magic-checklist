import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installGestureRearm } from "@/lib/speech";

installGestureRearm();

createRoot(document.getElementById("root")!).render(<App />);
