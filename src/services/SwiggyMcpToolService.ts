import { SwiggyMcpClient } from "../SwiggyMcpClient.js";

export class SwiggyMcpToolService {
  private readonly client = new SwiggyMcpClient();
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.client.connect();
    this.connected = true;
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    await this.connect();
    return this.client.listTools();
  }

  async getToolDefinition(name: string): Promise<any | undefined> {
    await this.connect();
    const tools = await this.client.listToolsFull();
    return (tools ?? []).find((t: any) => t.name === name || t.name?.toLowerCase() === name?.toLowerCase());
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect();
    return this.client.callTool(name, args);
  }
}
