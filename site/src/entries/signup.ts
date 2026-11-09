import { mount } from "svelte";
import "../app.css";
import Signup from "../pages/Signup.svelte";

mount(Signup, { target: document.getElementById("app")! });
