# Demo walkthrough

Use Node 20 or newer. Run `npm ci`, `npm run build`, and `npm run demo:seed` from the repository root. Then run `npm start` and open the printed board URL on port 3090. Each seed run creates a new sample board without changing existing boards.

For development, run `npm run dev` instead and use the printed URL on port 5173.

## A 60-second recording

1. Open the seeded board in two browser windows. Rename your display names to make the two peers clear.
2. Move **Touch interactions** to **Shipped**. Show the card appear in the other window.
3. Open **Offline queue**, change its description, and save. Show the updated description in the other window.
4. Resize one window to 390 × 844. Scroll across the columns. Tap a card, select a destination and position, and press **Move**.
5. Use the column arrow buttons to reorder a column. Both windows should use the same order.
6. Finish with the desktop board next to the phone-width browser. Both views show the same stored board.

The phone-width view is the responsive browser client. The sample cards are planning content.

## Check reconnect recovery

1. Open a board and keep the tab open.
2. Stop the Node server. The status should change to **Reconnecting**.
3. Edit a card while disconnected. The client applies it optimistically and keeps its intent in memory.
4. Restart the server with the same database. The client should rejoin, load the persisted board, and resend the pending intent.
5. Open the board in a second window and confirm the saved result.

Do not refresh the disconnected tab during this check. The web client does not persist its pending queue across a page reload. The restart integration test separately covers the harder case where a committed edit loses its acknowledgement and a later peer edit must survive the retry.

## Keyboard and touch checks

- Tab to a card and press Enter. Focus should move into the dialog.
- Press Tab and Shift+Tab. Focus should stay in the dialog. Press Escape to close it.
- Move a card with the destination and position controls. Use the column arrow buttons to reorder columns.
- On a touch screen, swipe across cards to scroll. Open a card and use **Move** to place it.
- Enable the operating system's reduced-motion preference. Animated pulses and transitions should stop.

## Configuration

`SYNCBOARD_DB` sets the database path for both the server and seed command. Use the same value for both. `PORT` sets the production server port and the production URL printed by the seed command. The Vite development proxy expects backend port 3090.
