import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  relationship: { isLoading: false, data: { nodes: [{ id: "me", label: "Me", nodeType: "Me" }], edges: [] } },
  instances: [] as Array<{ clear: ReturnType<typeof vi.fn>; data: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; changeSize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }>,
}));

vi.mock("../lib/hooks", () => ({ useRelationship: () => mocks.relationship }));
vi.mock("@antv/g6", () => ({ default: { Graph: class {
  clear = vi.fn();
  data = vi.fn();
  render = vi.fn();
  changeSize = vi.fn();
  destroy = vi.fn();
  get = vi.fn(() => ({ set: vi.fn() }));
  constructor() { mocks.instances.push(this); }
} } }));

import RelationshipGraph from "./relationship_graph";

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.relationship = { isLoading: false, data: { nodes: [{ id: "me", label: "Me", nodeType: "Me" }], edges: [] } };
});
afterEach(() => { cleanup(); window.onresize = null; vi.restoreAllMocks(); });

describe("relationship graph lifetime", () => {
  it("does not restart force layout for unrelated rerenders", () => {
    const view = render(<RelationshipGraph />);
    expect(mocks.instances).toHaveLength(1);
    const graph = mocks.instances[0];
    expect(graph.render).toHaveBeenCalledOnce();
    mocks.relationship.isLoading = true;
    view.rerender(<RelationshipGraph />);
    expect(mocks.instances).toHaveLength(1);
    expect(graph.clear).toHaveBeenCalledOnce();
    expect(graph.render).toHaveBeenCalledOnce();
    mocks.relationship.data = { nodes: [{ id: "course", label: "Course", nodeType: "Course" }], edges: [] };
    view.rerender(<RelationshipGraph />);
    expect(graph.render).toHaveBeenCalledTimes(2);
    expect(graph.data).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [expect.objectContaining({ id: "course" })] }));
  });

  it("destroys each departed graph and removes only its own resize listener", () => {
    const otherResize = vi.fn(); window.onresize = otherResize;
    window.addEventListener("resize", otherResize);
    for (let index = 0; index < 5; index++) {
      const view = render(<RelationshipGraph />);
      const graph = mocks.instances[index];
      expect(window.onresize).toBe(otherResize);
      window.dispatchEvent(new Event("resize"));
      expect(graph.changeSize).toHaveBeenCalledOnce();
      view.unmount();
      expect(graph.destroy).toHaveBeenCalledOnce();
      window.dispatchEvent(new Event("resize"));
      expect(graph.changeSize).toHaveBeenCalledOnce();
    }
    expect(otherResize).toHaveBeenCalledTimes(10);
    expect(window.onresize).toBe(otherResize);
    window.removeEventListener("resize", otherResize);
    for (const graph of mocks.instances) expect(graph.destroy).toHaveBeenCalledOnce();
  });

  it("owns separate instances across StrictMode effect replay", () => {
    const view = render(<StrictMode><RelationshipGraph /></StrictMode>);
    expect(mocks.instances).toHaveLength(2);
    expect(mocks.instances[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.instances[1].destroy).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("resize"));
    expect(mocks.instances[0].changeSize).not.toHaveBeenCalled();
    expect(mocks.instances[1].changeSize).toHaveBeenCalledOnce();
    view.unmount();
    expect(mocks.instances[1].destroy).toHaveBeenCalledOnce();
  });
});
