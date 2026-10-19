import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { LoginEvent, LoginPrompt, LoginState } from "@tandem/contracts";
import { AlertCircleIcon, CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useCommand } from "@/hooks/use-command.ts";
import { useConnected } from "@/rpc/connection.tsx";

/** A login running on the server: its events, the question it waits on, and how it ended. */
export function LoginFlow({ login }: { login: LoginState }) {
  return (
    <div className="grid gap-3">
      <ItemGroup className="gap-2">
        {login.events.map((event, index) => (
          // Events only accumulate, so their position is stable.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <LoginEventItem key={index} event={event} />
        ))}
      </ItemGroup>
      {login.status === "running" && login.prompt !== undefined && (
        <LoginPromptForm key={login.prompt.id} prompt={login.prompt} />
      )}
      {login.status === "running" && login.prompt === undefined && (
        <Item variant="muted" size="sm">
          <Spinner />
          <ItemContent>
            <ItemDescription>Waiting for the sign-in to finish…</ItemDescription>
          </ItemContent>
        </Item>
      )}
      {login.status === "succeeded" && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Signed in to {login.providerName}</AlertTitle>
          <AlertDescription>Its models are now available.</AlertDescription>
        </Alert>
      )}
      {login.status === "failed" && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Sign-in failed</AlertTitle>
          {login.error !== undefined && <AlertDescription>{login.error}</AlertDescription>}
        </Alert>
      )}
    </div>
  );
}

function LoginEventItem({ event }: { event: LoginEvent }) {
  switch (event.type) {
    case "auth_url":
      return (
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Continue in your browser</ItemTitle>
            <ItemDescription>{event.instructions ?? "Open the sign-in page and approve access."}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <a href={event.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
              Open
              <ExternalLinkIcon />
            </a>
          </ItemActions>
        </Item>
      );
    case "device_code":
      return (
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>{event.userCode}</ItemTitle>
            <ItemDescription>Enter this code on the verification page.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <a href={event.verificationUri} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
              Open
              <ExternalLinkIcon />
            </a>
          </ItemActions>
        </Item>
      );
    case "info":
    case "progress":
      return (
        <Item variant="muted" size="sm">
          <ItemContent>
            <ItemDescription>{event.message}</ItemDescription>
          </ItemContent>
        </Item>
      );
  }
}

function LoginPromptForm({ prompt }: { prompt: LoginPrompt }) {
  const { models } = useConnected();
  const [value, setValue] = useState("");
  const command = useCommand();
  const { pending, error } = command;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (value === "") return;
    void command.run(() => models.answerLogin({ promptId: prompt.id, value }, BACKGROUND_CONTEXT));
  };

  return (
    <form onSubmit={submit}>
      <Field data-invalid={error !== null}>
        <FieldLabel htmlFor="login-prompt">{prompt.message}</FieldLabel>
        <div className="flex gap-2">
          {prompt.type === "select" ? (
            <Select
              disabled={pending}
              value={value}
              onValueChange={(next) => setValue(next ?? "")}
              items={prompt.options.map((option) => ({ value: option.id, label: option.label }))}
            >
              <SelectTrigger id="login-prompt" className="flex-1">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {prompt.options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="login-prompt"
              disabled={pending}
              type={prompt.type === "secret" ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={prompt.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <Button type="submit" disabled={pending || value === ""}>
            Continue
          </Button>
        </div>
        {error !== null && <FieldError>{error}</FieldError>}
      </Field>
    </form>
  );
}
