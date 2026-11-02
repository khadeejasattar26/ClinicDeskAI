import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ClinicPage } from "./ClinicPage";
const response = (reply: string, actions: unknown[] = []) => ({
  ok: true,
  json: async () => ({
    conversationId: "11111111-1111-4111-8111-111111111111",
    reply,
    actions,
  }),
});
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
function page() {
  return render(
    <MemoryRouter>
      <ClinicPage />
    </MemoryRouter>,
  );
}
test("clinic page opens accessible chat, quick replies retrieve answers, Escape closes", async () => {
  vi.mocked(fetch).mockResolvedValue(
    response("Open Monday to Saturday, 9am–5pm.") as Response,
  );
  page();
  const user = userEvent.setup();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "A little care.",
  );
  await user.click(screen.getByRole("button", { name: "Open clinic chat" }));
  expect(
    screen.getByRole("region", { name: "Clinic reception chat" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Opening hours" }));
  expect(
    await screen.findByText("Open Monday to Saturday, 9am–5pm."),
  ).toBeVisible();
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).message,
  ).toBe("Opening hours");
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: "Open clinic chat" }),
  ).toHaveFocus();
});
test("availability selection collects details and requires a separate confirmation", async () => {
  const slot = { id: "slot-id", starts_at: "2026-11-10T04:00:00Z" };
  vi.mocked(fetch).mockResolvedValueOnce(
    response("Choose a time.", [{ type: "slots", data: [slot] }]) as Response,
  );
  page();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Book your visit" }));
  await user.click(screen.getByRole("button", { name: "Book an appointment" }));
  await user.click(await screen.findByRole("button", { name: /Tue,? 10 Nov/ }));
  await user.type(screen.getByLabelText("Full name"), "Demo Patient");
  await user.type(
    screen.getByLabelText("Email", { exact: true }),
    "patient@example.com",
  );
  await user.type(screen.getByLabelText("Phone"), "+923001234567");
  await user.type(
    screen.getByLabelText("Reason for visit"),
    "General consultation",
  );
  const booking = {
    slot_id: slot.id,
    starts_at: slot.starts_at,
    patient_name: "Demo Patient",
    patient_email: "patient@example.com",
    patient_phone: "+923001234567",
    reason: "General consultation",
  };
  vi.mocked(fetch).mockResolvedValueOnce(
    response("Review the details.", [
      { type: "confirm_booking", data: booking },
    ]) as Response,
  );
  fireEvent.submit(screen.getByRole("form", { name: "Booking details" }));
  expect(
    await screen.findByRole("button", { name: /Confirm booking/ }),
  ).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.mocked(fetch).mockResolvedValueOnce(
    response("Booked.", [
      {
        type: "booked",
        data: {
          id: "booking-id",
          starts_at: slot.starts_at,
          email_status: "preview",
        },
      },
    ]) as Response,
  );
  await user.click(screen.getByRole("button", { name: /Confirm booking/ }));
  expect(await screen.findByText("You're booked")).toBeVisible();
  expect(
    JSON.parse(vi.mocked(fetch).mock.calls[2][1]?.body as string).message,
  ).toBe("Confirm booking");
});
test("network errors are announced, input unlocks and new chat clears the session", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  page();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open clinic chat" }));
  await user.type(screen.getByLabelText("Message reception"), "hello");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach reception",
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Message reception")).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Start new chat" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
