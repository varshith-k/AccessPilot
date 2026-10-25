import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ProfileSection } from "@/components/ProfileSection";
import { PROFILE_STORAGE_KEY, profileStore } from "@/lib/client/profile";
import { renderWithAnnouncer } from "./helpers";

beforeEach(() => {
  window.localStorage.clear();
  profileStore.update({ name: "", email: "", phone: "", notes: "" });
});

describe("ProfileSection", () => {
  it("has labelled fields, warns against secrets, and passes axe", async () => {
    const { container } = renderWithAnnouncer(<ProfileSection />);
    expect(screen.getByRole("heading", { name: "Your details" })).toBeInTheDocument();
    for (const name of ["Full name", "Email", "Phone", "Anything else forms might ask"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByText(/Never put passwords or card numbers here/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("saves what is typed in this browser, and clears it", async () => {
    const user = userEvent.setup();
    renderWithAnnouncer(<ProfileSection />);
    await user.type(screen.getByLabelText("Full name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Anything else forms might ask"), "Program: Mathematics");
    const saved = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}");
    expect(saved).toMatchObject({ name: "Ada Lovelace", notes: "Program: Mathematics" });

    await user.click(screen.getByRole("button", { name: "Clear my details" }));
    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? "{}").name).toBe("");
  });
});
