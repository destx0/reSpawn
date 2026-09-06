import React, { Component } from 'react';
import { CoreStoreState } from '../../reducers/index.js';
import { connect } from 'react-redux';
import { JSONTree } from 'react-json-tree';
import { getActiveInstance } from '../../reducers/instances.js';

type Props = StateProps;

interface State {
  selected: string | undefined;
}
type StateProps = ReturnType<typeof mapStateToProps>;
class Checkpoints extends Component<Props, State> {
  handleSelect = (selected: string) => {
    this.setState({ selected });
  };

  render() {
    const { liftedState } = this.props;
    const currentstate =
      liftedState.computedStates?.[liftedState.currentStateIndex];
    let path = '';
    if (chrome && chrome.devtools && chrome.devtools.inspectedWindow) {
      path = chrome.devtools.inspectedWindow.tabId.toString();
      console.log(
        'Current State:',
        chrome,
        chrome.devtools.inspectedWindow.tabId,
      );
    }
    function getInspectedUrl(cb:(url:string)=>void){
      if (typeof chrome !== 'undefined' && chrome.devtools?.inspectedWindow){
        chrome.devtools.inspectedWindow.eval('window.location.href', (r)=>cb(r as string))
      } else if (chrome.tabs){
        chrome.tabs.query({active:true,currentWindow:true}, tabs=>cb(tabs[0].url))
      }
    }

    return (
      <>
        <JSONTree data={path} />
        <JSONTree data={currentstate} />
        <JSONTree data={liftedState} />
      </>
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
