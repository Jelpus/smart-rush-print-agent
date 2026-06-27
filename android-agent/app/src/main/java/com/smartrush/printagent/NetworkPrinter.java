package com.smartrush.printagent;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

final class NetworkPrinter {
    private NetworkPrinter() {
    }

    static void send(String ip, int port, byte[] data) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, port), 3000);
            OutputStream output = socket.getOutputStream();
            output.write(data);
            output.flush();
        }
    }
}
