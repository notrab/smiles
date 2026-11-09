import { mount } from "svelte";
import "../app.css";
import HowItWorks from "../pages/HowItWorks.svelte";

mount(HowItWorks, { target: document.getElementById("app")! });
