import { Schema } from "effect";

export class ConfigNotFound extends Schema.TaggedErrorClass<ConfigNotFound>()("ConfigNotFound", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Config file not found: ${this.path}`;
  }
}

export class InvalidConfig extends Schema.TaggedErrorClass<InvalidConfig>()("InvalidConfig", {
  details: Schema.String,
}) {
  override get message(): string {
    return `Invalid taizn.json:\n${this.details}`;
  }
}

export class InvalidEnvironment extends Schema.TaggedErrorClass<InvalidEnvironment>()(
  "InvalidEnvironment",
  {
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid TAIZN environment:\n${this.details}`;
  }
}

export class InvalidJson extends Schema.TaggedErrorClass<InvalidJson>()("InvalidJson", {
  file: Schema.String,
  details: Schema.String,
}) {
  override get message(): string {
    return `Invalid ${this.file}: ${this.details}`;
  }
}

export class MissingFile extends Schema.TaggedErrorClass<MissingFile>()("MissingFile", {
  label: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return `${this.label} not found: ${this.path}`;
  }
}

export class FileSystemFailure extends Schema.TaggedErrorClass<FileSystemFailure>()(
  "FileSystemFailure",
  {
    operation: Schema.String,
    path: Schema.String,
    cause: Schema.Defect,
  },
) {
  override get message(): string {
    return `File system ${this.operation} failed for ${this.path}`;
  }
}

export class CommandFailed extends Schema.TaggedErrorClass<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  args: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Command failed: ${this.command} ${this.args.join(" ")}`;
  }
}

export class PackageNotProduced extends Schema.TaggedErrorClass<PackageNotProduced>()(
  "PackageNotProduced",
  {
    outputDir: Schema.String,
  },
) {
  override get message(): string {
    return `No .wgt package was produced in ${this.outputDir}`;
  }
}

export class MissingPassword extends Schema.TaggedErrorClass<MissingPassword>()("MissingPassword", {
  variable: Schema.String,
  action: Schema.String,
}) {
  override get message(): string {
    return `${this.variable} is required to ${this.action}.`;
  }
}

export class SecretReadInterrupted extends Schema.TaggedErrorClass<SecretReadInterrupted>()(
  "SecretReadInterrupted",
  {},
) {
  override get message(): string {
    return "Secret prompt interrupted.";
  }
}

export class MultipleTargetsConnected extends Schema.TaggedErrorClass<MultipleTargetsConnected>()(
  "MultipleTargetsConnected",
  {
    targets: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Multiple Tizen targets are connected: ${this.targets.join(", ")}. Set TAIZN_TARGET explicitly.`;
  }
}

export type TaiznError =
  | CommandFailed
  | ConfigNotFound
  | FileSystemFailure
  | InvalidConfig
  | InvalidEnvironment
  | InvalidJson
  | MissingFile
  | MissingPassword
  | MultipleTargetsConnected
  | PackageNotProduced
  | SecretReadInterrupted;

export const renderError = (error: TaiznError) => error.message;
