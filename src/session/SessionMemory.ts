export class SessionMemory {

  private static memory: Record<string, any> = {};

  static set(
    key: string,
    value: any
  ) {
    this.memory[key] = value;
  }

  static get(
    key: string
  ) {
    return this.memory[key];
  }

  static clear() {
    this.memory = {};
  }
}