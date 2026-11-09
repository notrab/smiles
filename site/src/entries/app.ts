import { mount } from "svelte";
import "../app.css";
import Dashboard from "../pages/Dashboard.svelte";

mount(Dashboard, { target: document.getElementById("app")! });
