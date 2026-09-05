import { Schema } from "effect";

export class ConfigNotFound extends Schema.TaggedError<ConfigNotFound>()("ConfigNotFound", {
  path: Schema.String,
}) {
  override get message(): string {
    return `Config file not found: ${this.path}`;
  }
}

export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("InvalidConfig", {
  details: Schema.String,
}) {
  override get message(): string {
    return `Invalid taizn.json:\n${this.details}`;
  }
}

export class InvalidEnvironment extends Schema.TaggedError<InvalidEnvironment>()(
  "InvalidEnvironment",
  {
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid TAIZN environment:\n${this.details}`;
  }
}

export class InvalidJson extends Schema.TaggedError<InvalidJson>()("InvalidJson", {
  file: Schema.String,
  details: Schema.String,
}) {
  override get message(): string {
    return `Invalid ${this.file}: ${this.details}`;
  }
}

export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", {
  label: Schema.String,
  details: Schema.String,
}) {
  override get message(): string {
    return `Invalid ${this.label}: ${this.details}`;
  }
}

export class MissingFile extends Schema.TaggedError<MissingFile>()("MissingFile", {
  label: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return `${this.label} not found: ${this.path}`;
  }
}

export class FileSystemFailure extends Schema.TaggedError<FileSystemFailure>()(
  "FileSystemFailure",
  {
    operation: Schema.String,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `File system ${this.operation} failed for ${this.path}`;
  }
}

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  args: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `Command failed: ${this.command} ${this.args.join(" ")}`;
  }
}

export class CommandTimeout extends Schema.TaggedError<CommandTimeout>()("CommandTimeout", {
  command: Schema.String,
  args: Schema.Array(Schema.String),
  timeoutMs: Schema.Number,
}) {
  override get message(): string {
    return `Command timed out after ${this.timeoutMs} ms: ${this.command} ${this.args.join(" ")}`;
  }
}

export class ApplicationNotFound extends Schema.TaggedError<ApplicationNotFound>()(
  "ApplicationNotFound",
  {
    query: Schema.String,
  },
) {
  override get message(): string {
    return `No installed Tizen application matched "${this.query}".`;
  }
}

export class MultipleApplicationsMatched extends Schema.TaggedError<MultipleApplicationsMatched>()(
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

export class PackageNotProduced extends Schema.TaggedError<PackageNotProduced>()(
  "PackageNotProduced",
  {
    outputDir: Schema.String,
  },
) {
  override get message(): string {
    return `No .wgt package was produced in ${this.outputDir}`;
  }
}

export class MissingPassword extends Schema.TaggedError<MissingPassword>()("MissingPassword", {
  variable: Schema.String,
  action: Schema.String,
}) {
  override get message(): string {
    return `${this.variable} is required to ${this.action}.`;
  }
}

export class SecretReadInterrupted extends Schema.TaggedError<SecretReadInterrupted>()(
  "SecretReadInterrupted",
  {},
) {
  override get message(): string {
    return "Secret prompt interrupted.";
  }
}

export class MultipleTargetsConnected extends Schema.TaggedError<MultipleTargetsConnected>()(
  "MultipleTargetsConnected",
  {
    targets: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Multiple Tizen targets are connected: ${this.targets.join(", ")}. Set TAIZN_TARGET explicitly.`;
  }
}

export class MissingTizenTarget extends Schema.TaggedError<MissingTizenTarget>()(
  "MissingTizenTarget",
  {},
) {
  override get message(): string {
    return "No Tizen target is connected. Set TAIZN_TARGET or connect exactly one device.";
  }
}

export class MissingTvRemoteHost extends Schema.TaggedError<MissingTvRemoteHost>()(
  "MissingTvRemoteHost",
  {},
) {
  override get message(): string {
    return "Samsung TV host is required. Set TAIZN_TV_HOST or TAIZN_TARGET.";
  }
}

export class MissingTvRemoteToken extends Schema.TaggedError<MissingTvRemoteToken>()(
  "MissingTvRemoteToken",
  {},
) {
  override get message(): string {
    return "Samsung TV remote token is required. Run `taizn tv pair` or set TAIZN_TV_TOKEN.";
  }
}

export class TvRemoteConnectionFailed extends Schema.TaggedError<TvRemoteConnectionFailed>()(
  "TvRemoteConnectionFailed",
  {
    cause: Schema.Defect(),
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV remote connection failed: ${this.target}`;
  }
}

export class TvRemoteProtocolError extends Schema.TaggedError<TvRemoteProtocolError>()(
  "TvRemoteProtocolError",
  {
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV remote protocol error: ${this.details}`;
  }
}

export class TvRemoteTimeout extends Schema.TaggedError<TvRemoteTimeout>()("TvRemoteTimeout", {
  target: Schema.String,
}) {
  override get message(): string {
    return `Timed out waiting for Samsung TV remote response: ${this.target}`;
  }
}

export class TvRemoteUnauthorized extends Schema.TaggedError<TvRemoteUnauthorized>()(
  "TvRemoteUnauthorized",
  {
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Samsung TV denied remote control access: ${this.target}`;
  }
}

export class SellerBrowserNotFound extends Schema.TaggedError<SellerBrowserNotFound>()(
  "SellerBrowserNotFound",
  {
    path: Schema.String,
  },
) {
  override get message(): string {
    return `Seller Office browser not found: ${this.path}. Set TAIZN_SELLER_BROWSER explicitly.`;
  }
}

export class SellerSessionNotFound extends Schema.TaggedError<SellerSessionNotFound>()(
  "SellerSessionNotFound",
  {
    path: Schema.String,
  },
) {
  override get message(): string {
    return `Seller Office browser session not found: ${this.path}. Run \`taizn seller login\` first.`;
  }
}

export class SellerBrowserConnectionFailed extends Schema.TaggedError<SellerBrowserConnectionFailed>()(
  "SellerBrowserConnectionFailed",
  {
    cause: Schema.Unknown,
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Seller Office browser connection failed: ${this.target}. Run \`taizn seller login\` again.`;
  }
}

export class SellerAuthenticationRequired extends Schema.TaggedError<SellerAuthenticationRequired>()(
  "SellerAuthenticationRequired",
  {},
) {
  override get message(): string {
    return "Seller Office is signed out. Run `taizn seller login` and finish Samsung login in the visible browser.";
  }
}

export class SellerPortalDrift extends Schema.TaggedError<SellerPortalDrift>()(
  "SellerPortalDrift",
  {
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Seller Office portal layout changed: ${this.details}`;
  }
}

export class SellerPortalProtocolError extends Schema.TaggedError<SellerPortalProtocolError>()(
  "SellerPortalProtocolError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    details: Schema.String,
  },
) {
  override get message(): string {
    return `Seller Office browser protocol failed: ${this.details}`;
  }
}

export type TaiznError =
  | ApplicationNotFound
  | CommandFailed
  | CommandTimeout
  | ConfigNotFound
  | FileSystemFailure
  | InvalidConfig
  | InvalidEnvironment
  | InvalidInput
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
  | SellerAuthenticationRequired
  | SellerBrowserConnectionFailed
  | SellerBrowserNotFound
  | SellerPortalDrift
  | SellerPortalProtocolError
  | SellerSessionNotFound
  | TvRemoteConnectionFailed
  | TvRemoteProtocolError
  | TvRemoteTimeout
  | TvRemoteUnauthorized;

export const renderError = (error: TaiznError) => error.message;

export const renderErrorJson = (error: TaiznError) =>
  JSON.stringify({
    error: {
      message: error.message,
      type: error._tag,
    },
    ok: false,
  });
