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

export class ApplicationNotFound extends Schema.TaggedErrorClass<ApplicationNotFound>()(
  "ApplicationNotFound",
  {
    query: Schema.String,
  },
) {
  override get message(): string {
    return `No installed Tizen application matched "${this.query}".`;
  }
}

export class MultipleApplicationsMatched extends Schema.TaggedErrorClass<MultipleApplicationsMatched>()(
  "MultipleApplicationsMatched",
  {
    matches: Schema.Array(Schema.String),
    query: Schema.String,
  },
) {
  override get message(): string {
    return `Multiple installed Tizen applications matched "${this.query}": ${this.matches.join(", ")}. Use the application ID.`;
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

export class MissingTizenTarget extends Schema.TaggedErrorClass<MissingTizenTarget>()(
  "MissingTizenTarget",
  {},
) {
  override get message(): string {
    return "No Tizen target is connected. Set TAIZN_TARGET or connect exactly one device.";
  }
}

export class MissingTvRemoteHost extends Schema.TaggedErrorClass<MissingTvRemoteHost>()(
  "MissingTvRemoteHost",
  {},
) {
  override get message(): string {
    return "Samsung TV host is required. Set TAIZN_TV_HOST or TAIZN_TARGET.";
  }
}

export class MissingTvRemoteToken extends Schema.TaggedErrorClass<MissingTvRemoteToken>()(
  "MissingTvRemoteToken",
  {},
) {
  override get message(): string {
    return "Samsung TV remote token is required. Run `taizn tv pair` or set TAIZN_TV_TOKEN.";
  }
}

export class TvRemoteConnectionFailed extends Schema.TaggedErrorClass<TvRemoteConnectionFailed>()(
  "TvRemoteConnectionFailed",
  {
    cause: Schema.Defect,
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV remote connection failed: ${this.target}`;
  }
}

export class TvRemoteProtocolError extends Schema.TaggedErrorClass<TvRemoteProtocolError>()(
  "TvRemoteProtocolError",
  {
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV remote protocol error: ${this.details}`;
  }
}

export class TvRemoteTimeout extends Schema.TaggedErrorClass<TvRemoteTimeout>()("TvRemoteTimeout", {
  target: Schema.String,
}) {
  override get message(): string {
    return `Timed out waiting for Samsung TV remote response: ${this.target}`;
  }
}

export class TvRemoteUnauthorized extends Schema.TaggedErrorClass<TvRemoteUnauthorized>()(
  "TvRemoteUnauthorized",
  {
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV denied remote control access: ${this.target}`;
  }
}

export type TaiznError =
  | ApplicationNotFound
  | CommandFailed
  | ConfigNotFound
  | FileSystemFailure
  | InvalidConfig
  | InvalidEnvironment
  | InvalidJson
  | MissingFile
  | MissingPassword
  | MissingTizenTarget
  | MissingTvRemoteHost
  | MissingTvRemoteToken
  | MultipleApplicationsMatched
  | MultipleTargetsConnected
  | PackageNotProduced
  | SecretReadInterrupted
  | TvRemoteConnectionFailed
  | TvRemoteProtocolError
  | TvRemoteTimeout
  | TvRemoteUnauthorized;

export const renderError = (error: TaiznError) => error.message;
