declare module "three/examples/jsm/controls/OrbitControls.js" {
  export { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
}

declare module "three/examples/jsm/webxr/VRButton.js" {
  export const VRButton: {
    createButton: (renderer: any, sessionInit?: Record<string, unknown>) => HTMLElement;
  };
}
