import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScannedReposTable } from "../../src/components/scanned-repos-table";
import { EScanStatus } from "../../src/lib/constant/scan-status.constant";
import { IScannedRepo } from "../../src/lib/types/scanned-repo.type";

const repo: IScannedRepo = {
  repoId: 42,
  owner: "octocat",
  name: "hello-world",
  status: EScanStatus.DONE,
  lastCommitSha: "abc123def456",
  startedAt: "2026-09-12T00:00:00.000Z",
  scannedAt: "2026-09-12T00:01:00.000Z",
  failReason: null,
  retryCount: 0,
  findingsCount: 3,
};

describe("ScannedReposTable", () => {
  it("renders the repos it is given", () => {
    render(<ScannedReposTable repos={[repo]} />);

    expect(screen.getByText("octocat/hello-world")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows an empty state when nothing has been scanned", () => {
    render(<ScannedReposTable repos={[]} />);
    expect(
      screen.getByText("Nothing scanned yet — run Discover, then Scan."),
    ).toBeInTheDocument();
  });

  it("shows current-file and history coverage independently", () => {
    render(
      <ScannedReposTable
        repos={[
          {
            ...repo,
            headPhase: {
              status: "done",
              targetSha: "a".repeat(40),
              completedSha: "a".repeat(40),
              reason: null,
            },
            historyPhase: {
              status: "incomplete",
              targetSha: "a".repeat(40),
              completedSha: null,
              reason: "history cache budget exceeded",
            },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(/Current files checked:/).closest("p"),
    ).toHaveTextContent("done");
    expect(screen.getByText(/History:/).closest("p")).toHaveTextContent(
      "incomplete",
    );
    expect(screen.getByText(/History:/).closest("p")).toHaveTextContent(
      "history cache budget exceeded",
    );
  });
});
