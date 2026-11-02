import { mount } from "svelte";
import App from "./App.svelte";
import { charger } from "./lib/charger.svelte.js";
import "./app.css";

mount(App, { target: document.getElementById("app") });
charger.resume();
