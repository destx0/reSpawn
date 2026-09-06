import React, { Component } from 'react';
import { CoreStoreState } from '../../reducers/index.js';
import { connect } from 'react-redux';
import { JSONTree } from 'react-json-tree';
import { getActiveInstance } from '../../reducers/instances.js';

type Props = StateProps;

interface State {
  selected: string | undefined;
  inspectedUrl: string;
  inspectedHost: string;
}
type StateProps = ReturnType<typeof mapStateToProps>;
class Checkpoints extends Component<Props, State> {
  state: State = { selected: undefined, inspectedUrl: '', inspectedHost: '' };

  componentDidMount() {
    this.fetchInspectedUrl();
  }

  fetchInspectedUrl = () => {
    const set = (u: string) => {
      try {
        this.setState({ inspectedUrl: u, inspectedHost: new URL(u).host });
      } catch {
        this.setState({ inspectedUrl: u, inspectedHost: u });
      }
    };
    if ((chrome as any)?.devtools?.inspectedWindow)
      (chrome as any).devtools.inspectedWindow.eval(
        'window.location.href',
        (r: any) => typeof r === 'string' && set(r),
      );
    else if ((chrome as any)?.tabs)
      (chrome as any).tabs.query(
        { active: true, currentWindow: true },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        (t: any) => t[0]?.url && set(t[0].url),
      );
    else set(window.location.href);
  };

  handleSelect = (selected: string) => {
    this.setState({ selected });
  };

  render() {
    const { liftedState } = this.props;
    if (!liftedState) {
      return <div>No store found.</div>;
    }
    const currentState =
      liftedState.computedStates?.[liftedState.currentStateIndex]?.state;
    const { inspectedUrl, inspectedHost } = this.state;

    return (
      <div style={{ padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
        <div>Host: {inspectedHost || 'loading...'}</div>
        <div>URL: {inspectedUrl || 'loading...'}</div>
        <h4>Current State</h4>
        <JSONTree data={currentState} hideRoot />
        <h4>Current ComputedState</h4>
        <JSONTree
          data={liftedState.computedStates?.[liftedState.currentStateIndex]}
        />
      </div>
    );
  }
}
const mapStateToProps = (state: CoreStoreState) => {
  const instances = state.instances;
  const id = getActiveInstance(instances);
  return {
    liftedState: instances.states[id],
  };
};
export default connect(mapStateToProps)(Checkpoints);
