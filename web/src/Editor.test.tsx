// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Editor } from "./Editor";
import { CreateDialog } from "./CreateDialog";
import { api, type ArtifactDetail } from "./api";

vi.mock("./Preview", () => ({ Preview: () => null }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(api).mockReset();
});
const artifact: ArtifactDetail = {
  id: "one",
  title: "Notes",
  kind: "markdown",
  collection: "",
  revision: 1,
  created_at: "now",
  updated_at: "now",
  content: "original",
  versions: [{ version: 1, note: "", created_at: "now" }],
};

test("saving freezes the submitted draft and applies the response without a follow-up GET", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const changed = vi.fn();
  render(<Editor artifact={artifact} onChanged={changed} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
  const editor = await screen.findByLabelText("产物源代码");
  fireEvent.change(editor, { target: { value: "edited" } });
  fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));
  expect((editor as HTMLTextAreaElement).disabled).toBe(true);
  await act(async () =>
    finish({ ...artifact, revision: 2, updated_at: "later" }),
  );
  expect(api).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: 2,
      content: "edited",
      versions: [
        { version: 2, note: "", created_at: "later" },
        ...artifact.versions,
      ],
    }),
  );
});

test("a conflicting save retains the draft and does not update parent metadata", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Revision conflict"));
  const changed = vi.fn();
  render(<Editor artifact={artifact} onChanged={changed} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
  const editor = await screen.findByLabelText("产物源代码");
  fireEvent.change(editor, { target: { value: "keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));
  await screen.findByRole("alert");
  expect((editor as HTMLTextAreaElement).value).toBe("keep this draft");
  expect(changed).not.toHaveBeenCalled();
});

test("unsaved record text triggers a close confirmation", async () => {
  vi.mocked(api).mockResolvedValue({ items: [] });
  const close = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Editor artifact={artifact} onChanged={vi.fn()} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "相关记录" }));
  fireEvent.change(await screen.findByLabelText("为这个产物留一条记录"), {
    target: { value: "unsubmitted record" },
  });
  fireEvent.click(screen.getByRole("button", { name: "← 产物库" }));
  expect(confirm).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test("creation opens the committed artifact with no second network dependency", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  vi.mocked(api).mockResolvedValue(artifact);
  const created = vi.fn();
  render(<CreateDialog onClose={vi.fn()} onCreated={created} />);
  fireEvent.change(screen.getByPlaceholderText("给这个成果一个名字"), {
    target: { value: "Notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建产物" }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledTimes(1);
  expect(created).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "one",
      content: expect.any(String),
      versions: [{ version: 1, note: "", created_at: "now" }],
    }),
  );
});
