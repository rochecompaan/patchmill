import {
  Container,
  Input,
  ProcessTerminal,
  SelectList,
  Text,
  TUI,
  getKeybindings,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type Terminal,
} from "@earendil-works/pi-tui";
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import {
  createModelSelectorState,
  formatModelSelectorCount,
  modelSelectorDetails,
  searchModelSelector,
  selectedModel,
  type ModelSelectorState,
} from "./pi-model-selector-state.ts";
import type { PiModelChoice } from "./pi-preflight.ts";

export type InteractiveModelSelector = (options: {
  models: PiModelChoice[];
  current?: LocalPiDefaultModel;
  terminal?: Terminal;
}) => Promise<PiModelChoice | undefined>;

const selectorTheme: SelectListTheme = {
  selectedPrefix: (text) => `→ ${text}`,
  selectedText: (text) => text,
  description: (text) => text,
  scrollInfo: (text) => text,
  noMatch: (text) => text.replace("commands", "models"),
};

function modelItem(
  model: PiModelChoice,
  current: LocalPiDefaultModel | undefined,
): SelectItem {
  const isCurrent =
    current?.provider === model.provider && current.modelId === model.id;
  return {
    value: model.value,
    label: `${model.id} [${model.provider}]${isCurrent ? " ✓" : ""}`,
    description: model.label,
  };
}

class ModelSelectorComponent extends Container implements Focusable {
  private readonly current: LocalPiDefaultModel | undefined;
  private readonly onSelect: (model: PiModelChoice) => void;
  private readonly onCancel: () => void;
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly count = new Text();
  private readonly details = new Text();
  private state: ModelSelectorState;
  private list: SelectList;
  private isFocused = false;

  constructor(
    models: PiModelChoice[],
    current: LocalPiDefaultModel | undefined,
    onSelect: (model: PiModelChoice) => void,
    onCancel: () => void,
  ) {
    super();
    this.current = current;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
    this.state = createModelSelectorState(models, { current });
    this.list = this.createList();

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

    this.renderList();
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
      this.list.handleInput(data);
      return;
    }

    this.searchInput.handleInput(data);
    this.state = searchModelSelector(this.state, this.searchInput.getValue());
    this.renderList();
    this.updateFooter();
  }

  private createList(): SelectList {
    const list = new SelectList(
      this.state.filtered.map((model) => modelItem(model, this.current)),
      10,
      selectorTheme,
    );
    list.onCancel = this.onCancel;
    list.onSelect = (item) => {
      const model = this.state.filtered.find(
        (entry) => entry.value === item.value,
      );
      if (model) this.onSelect(model);
    };
    list.onSelectionChange = (item) => {
      const index = this.state.filtered.findIndex(
        (model) => model.value === item.value,
      );
      this.state = { ...this.state, selectedIndex: Math.max(0, index) };
      this.updateFooter();
    };
    list.setSelectedIndex(this.state.selectedIndex);
    return list;
  }

  private renderList(): void {
    this.list = this.createList();
    this.listContainer.clear();
    this.listContainer.addChild(this.list);
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
