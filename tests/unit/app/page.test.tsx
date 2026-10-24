import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import Home from "@/app/page";

describe("Home page", () => {
  it("renders one h1, every landmark, and a skip link with no axe violations", async () => {
    const { container } = render(<Home />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AccessPilot");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
    expect(screen.getByRole("complementary", { name: "Browser preview" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main",
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
