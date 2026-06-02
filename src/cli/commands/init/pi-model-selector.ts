import {
  Container,
  Input,
  ProcessTerminal,
  Text,
  TruncatedText,
  TUI,
  getKeybindings,
  type Focusable,
  type Terminal,
} from "@earendil-works/pi-tui";
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import {
  createModelSelectorState,
  formatModelSelectorCount,
  modelSelectorDetails,
  moveModelSelection,
  searchModelSelector,
  selectedModel,
  visibleModelRows,
  type ModelSelectorState,
  type VisibleModelRow,
} from "./pi-model-selector-state.ts";
import type { PiModelChoice } from "./pi-preflight.ts";

export type InteractiveModelSelector = (options: {
  models: PiModelChoice[];
  current?: LocalPiDefaultModel;
  terminal?: Terminal;
}) => Promise<PiModelChoice | undefined>;

function modelRow(row: VisibleModelRow): string {
  const prefix = row.selected ? "→" : " ";
  const current = row.current ? " ✓" : "";
  return `${prefix} ${row.model.id} [${row.model.provider}]${current}  ${row.model.label}`;
}

class ModelSelectorComponent extends Container implements Focusable {
  private readonly onSelect: (model: PiModelChoice) => void;
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly count = new Text();
  private readonly details = new Text();
  private state: ModelSelectorState;
  private isFocused = false;

  constructor(
    models: PiModelChoice[],
    current: LocalPiDefaultModel | undefined,
    onSelect: (model: PiModelChoice) => void,
    onCancel: () => void,
  ) {
    super();
    this.onSelect = onSelect;
    this.state = createModelSelectorState(models, { current });

    this.searchInput.onEscape = onCancel;
    this.searchInput.onSubmit = () => {
      const model = selectedModel(this.state);
      if (model) this.onSelect(model);
    };

    this.addChild(this.searchInput);
    this.addChild(new Text(""));
    this.addChild(this.listContainer);
    this.addChild(this.count);
    this.addChild(new Text(""));
    this.addChild(this.details);

    this.renderRows();
    this.updateFooter();
  }

  get focused(): boolean {
    return this.isFocused;
  }

  set focused(value: boolean) {
    this.isFocused = value;
    this.searchInput.focused = value;
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (
      keybindings.matches(data, "tui.select.up") ||
      keybindings.matches(data, "tui.select.down")
    ) {
      this.state = moveModelSelection(
        this.state,
        keybindings.matches(data, "tui.select.up") ? -1 : 1,
      );
      this.renderRows();
      this.updateFooter();
      return;
    }

    this.searchInput.handleInput(data);
    this.state = searchModelSelector(this.state, this.searchInput.getValue());
    this.renderRows();
    this.updateFooter();
  }

  private renderRows(): void {
    this.listContainer.clear();
    const rows = visibleModelRows(this.state);
    if (rows.length === 0) {
      this.listContainer.addChild(new Text("  No matching models"));
      return;
    }
    for (const row of rows) {
      this.listContainer.addChild(new TruncatedText(modelRow(row)));
    }
  }

  private updateFooter(): void {
    this.count.setText(formatModelSelectorCount(this.state));
    this.details.setText(modelSelectorDetails(this.state));
  }
}

export async function selectModelInteractively(options: {
  models: PiModelChoice[];
  current?: LocalPiDefaultModel;
  terminal?: Terminal;
}): Promise<PiModelChoice | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, true);

  return new Promise((resolve) => {
    let finished = false;

    const finish = (model: PiModelChoice | undefined): void => {
      if (finished) return;
      finished = true;

      void (async () => {
        try {
          try {
            tui.stop();
          } catch {
            // Best-effort cleanup before returning control to the caller.
          }

          try {
            await terminal.drainInput();
          } catch {
            // Best-effort cleanup before returning control to the caller.
          }
        } finally {
          resolve(model);
        }
      })();
    };

    const component = new ModelSelectorComponent(
      options.models,
      options.current,
      (model) => void finish(model),
      () => void finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}
