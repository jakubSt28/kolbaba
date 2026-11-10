import { createServer, type Server, type Socket } from "node:net";

export interface SmtpCapture {
  server: Server;
  port: number;
  mails: { from: string; to: string[]; data: string }[];
}

/** Just enough ESMTP for nodemailer: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA. */
export async function fakeSmtp(): Promise<SmtpCapture> {
  const mails: SmtpCapture["mails"] = [];
  const server = createServer((socket: Socket) => {
    let buffer = "";
    let inData = false;
    let current = { from: "", to: [] as string[], data: "" };
    let authStep = 0;
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            mails.push(current);
            current = { from: "", to: [], data: "" };
            socket.write("250 queued\r\n");
          } else current.data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          continue;
        }
        if (authStep > 0) {
          authStep = authStep === 1 ? 2 : 0;
          socket.write(authStep ? "334 UGFzc3dvcmQ6\r\n" : "235 ok\r\n");
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) socket.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (cmd.startsWith("AUTH PLAIN")) socket.write("235 ok\r\n");
        else if (cmd.startsWith("AUTH LOGIN")) {
          authStep = 1;
          socket.write("334 VXNlcm5hbWU6\r\n");
        } else if (cmd.startsWith("MAIL FROM")) {
          current.from = line.slice(10);
          socket.write("250 ok\r\n");
        } else if (cmd.startsWith("RCPT TO")) {
          current.to.push(line.slice(8));
          socket.write("250 ok\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (cmd === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0, mails };
}

