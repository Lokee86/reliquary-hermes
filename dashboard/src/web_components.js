/** @param {import("../types").HermesDashboardSDK} sdk */
function webComponents(sdk) {
  const { Button, Input, Checkbox, Select, SelectOption } = sdk.components;
  const h = sdk.React.createElement;
  return {
    /** @param {Record<string, unknown>} props */
    Button(props) {
      const quiet = props["aria-pressed"] === false || props["aria-current"] === false;
      return h(Button, { ...props, ghost: quiet });
    },
    Input, Checkbox, Textarea: /** @type {const} */ ("textarea"),
    /** @param {import("../types").HostSelectProps} props */
    Select({ value, options, onValueChange, disabled }) {
      return h(Select, { value, onValueChange, disabled },
        ...options.map(({ value, label }) => h(SelectOption, { key: value, value }, label)));
    },
  };
}
