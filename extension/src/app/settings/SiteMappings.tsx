import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container } from '@redux-devtools/ui';
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiGlobe,
  FiPlus,
  FiSave,
  FiTrash2,
} from 'react-icons/fi';
import { requestCheckpoints } from '../../checkpoints/messages.js';
import {
  readSiteMappings,
  SITE_MAPPINGS_KEY,
  writeSiteMappings,
} from '../../checkpoints/siteSettings.js';
import {
  createSiteId,
  SiteEnvironment,
  SiteMapping,
  SiteMappingSuggestion,
  suggestedSiteMappings,
  suggestionToMapping,
  validateSiteMappings,
} from '../../checkpoints/sites.js';
import {
  BaseInput,
  Button,
  Card,
  CardHeader,
  Empty,
  EnvironmentName,
  ErrorList,
  Footer,
  Hint,
  IconButton,
  NameInput,
  Page,
  Row,
  Section,
  SectionTitle,
  Status,
  Suggestion,
  SuggestionBases,
  SuggestionMain,
  SuggestionTitle,
  Warning,
} from './styles.js';

interface Message {
  readonly kind: 'error' | 'success';
  readonly text: string;
}

function blankEnvironment(name = 'Environment', baseUrl = ''): SiteEnvironment {
  return { id: createSiteId('environment'), name, baseUrl };
}

function blankMapping(): SiteMapping {
  return {
    id: createSiteId('mapping'),
    name: 'New mapping',
    environments: [
      blankEnvironment('Production'),
      blankEnvironment('Local', 'localhost:4200'),
    ],
  };
}

function isBroad(suggestion: SiteMappingSuggestion): boolean {
  return suggestion.environments.some((environment) => {
    const base = environment.baseUrl.trim();
    return base === '*' || base.startsWith('*/') || base.startsWith('*://');
  });
}

export default function SiteMappings() {
  const [mappings, setMappings] = useState<SiteMapping[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    void readSiteMappings().then((saved) => {
      if (!alive) return;
      setMappings(saved);
      setLoaded(true);
    });

    const tabId =
      typeof chrome !== 'undefined'
        ? chrome.devtools?.inspectedWindow?.tabId
        : undefined;
    if (tabId !== undefined) {
      void requestCheckpoints({ type: 'RESPAWN/CONTEXT', tabId }).then(
        (response) => {
          if (alive && response.ok) setCurrentUrl(response.context.url);
        },
      );
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (
        (area !== 'sync' && area !== 'local') ||
        !changes[SITE_MAPPINGS_KEY] ||
        dirty
      ) {
        return;
      }
      void readSiteMappings().then(setMappings);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [dirty]);

  useEffect(() => {
    if (message?.kind !== 'success') return;
    const timer = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const errors = useMemo(() => validateSiteMappings(mappings), [mappings]);
  const suggestions = useMemo(
    () => (loaded ? suggestedSiteMappings(currentUrl, mappings) : []),
    [currentUrl, loaded, mappings],
  );

  const touch = useCallback(() => {
    setDirty(true);
    setMessage(null);
  }, []);

  const updateMapping = useCallback(
    (id: string, update: (mapping: SiteMapping) => SiteMapping) => {
      setMappings((items) =>
        items.map((mapping) => (mapping.id === id ? update(mapping) : mapping)),
      );
      touch();
    },
    [touch],
  );

  const updateEnvironment = useCallback(
    (
      mappingId: string,
      environmentId: string,
      update: (environment: SiteEnvironment) => SiteEnvironment,
    ) => {
      updateMapping(mappingId, (mapping) => ({
        ...mapping,
        environments: mapping.environments.map((environment) =>
          environment.id === environmentId ? update(environment) : environment,
        ),
      }));
    },
    [updateMapping],
  );

  const addMapping = () => {
    setMappings((items) => [...items, blankMapping()]);
    touch();
  };

  const addEnvironment = (mappingId: string) => {
    updateMapping(mappingId, (mapping) => ({
      ...mapping,
      environments: [...mapping.environments, blankEnvironment()],
    }));
  };

  const removeEnvironment = (mappingId: string, environmentId: string) => {
    updateMapping(mappingId, (mapping) => ({
      ...mapping,
      environments: mapping.environments.filter(
        (environment) => environment.id !== environmentId,
      ),
    }));
  };

  const removeMapping = (mappingId: string) => {
    setMappings((items) => items.filter((mapping) => mapping.id !== mappingId));
    touch();
  };

  const addSuggestion = (suggestion: SiteMappingSuggestion) => {
    const mapping = suggestionToMapping(suggestion);
    setMappings((items) => [...items, mapping]);
    touch();
    setMessage({
      kind: 'success',
      text: `Added “${mapping.name}”. Save to apply.`,
    });
  };

  const save = async () => {
    if (errors.length) {
      setMessage({ kind: 'error', text: 'Fix the errors before saving.' });
      return;
    }
    try {
      await writeSiteMappings(mappings);
      setDirty(false);
      setMessage({ kind: 'success', text: 'Saved.' });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not save.',
      });
    }
  };

  return (
    <Container>
      <Page>
        <Section>
          <SectionTitle>Site mappings</SectionTitle>
          <Hint>
            Connect the same app across environments. http and https are treated
            the same. Use <code>*</code> for any host and{' '}
            <code>*.example.com</code> for subdomains. A path like{' '}
            <code>/app</code> maps that prefix to the other environment.
          </Hint>
          {!loaded && <Empty>Loading…</Empty>}
          {loaded && mappings.length === 0 && (
            <Empty>No mappings yet. Add one below, or use a suggestion.</Empty>
          )}
          {mappings.map((mapping) => (
            <Card key={mapping.id}>
              <CardHeader>
                <NameInput
                  value={mapping.name}
                  placeholder="Mapping name"
                  aria-label="Mapping name"
                  onChange={(event) =>
                    updateMapping(mapping.id, (item) => ({
                      ...item,
                      name: event.target.value,
                    }))
                  }
                />
                <IconButton
                  danger
                  title={`Remove ${mapping.name || 'mapping'}`}
                  aria-label={`Remove ${mapping.name || 'mapping'}`}
                  onClick={() => removeMapping(mapping.id)}
                >
                  <FiTrash2 />
                </IconButton>
              </CardHeader>
              {mapping.environments.map((environment) => (
                <Row key={environment.id}>
                  <EnvironmentName
                    value={environment.name}
                    placeholder="Environment"
                    aria-label="Environment name"
                    onChange={(event) =>
                      updateEnvironment(mapping.id, environment.id, (item) => ({
                        ...item,
                        name: event.target.value,
                      }))
                    }
                  />
                  <BaseInput
                    value={environment.baseUrl}
                    placeholder="abc.com/app or */app"
                    aria-label="Base URL"
                    spellCheck={false}
                    onChange={(event) =>
                      updateEnvironment(mapping.id, environment.id, (item) => ({
                        ...item,
                        baseUrl: event.target.value,
                      }))
                    }
                  />
                  <IconButton
                    danger
                    title={`Remove ${environment.name || 'environment'}`}
                    aria-label={`Remove ${environment.name || 'environment'}`}
                    onClick={() =>
                      removeEnvironment(mapping.id, environment.id)
                    }
                  >
                    <FiTrash2 />
                  </IconButton>
                </Row>
              ))}
              <div>
                <Button onClick={() => addEnvironment(mapping.id)}>
                  <FiPlus /> Add environment
                </Button>
              </div>
            </Card>
          ))}
          <div>
            <Button primary onClick={addMapping}>
              <FiPlus /> Add mapping
            </Button>
          </div>
        </Section>

        {suggestions.length > 0 && (
          <Section>
            <SectionTitle>Suggested settings</SectionTitle>
            {suggestions.map((suggestion) => (
              <Suggestion key={suggestion.id}>
                <SuggestionMain>
                  <SuggestionTitle>
                    {suggestion.name}
                    {isBroad(suggestion) && (
                      <Warning>
                        {' '}
                        <FiAlertTriangle /> Matches every site
                      </Warning>
                    )}
                  </SuggestionTitle>
                  <SuggestionBases>
                    {suggestion.environments.map((environment) => (
                      <span key={environment.id}>
                        {environment.name}: {environment.baseUrl}
                      </span>
                    ))}
                  </SuggestionBases>
                </SuggestionMain>
                <Button primary onClick={() => addSuggestion(suggestion)}>
                  <FiGlobe /> Add
                </Button>
              </Suggestion>
            ))}
          </Section>
        )}

        {errors.length > 0 && (
          <ErrorList>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ErrorList>
        )}

        {message && (
          <Status kind={message.kind}>
            {message.kind === 'error' ? <FiAlertCircle /> : <FiCheckCircle />}
            {message.text}
          </Status>
        )}

        <Footer>
          <span>
            {!loaded ? 'Loading…' : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <Button
            primary
            disabled={!dirty || errors.length > 0}
            onClick={() => void save()}
          >
            <FiSave /> Save
          </Button>
        </Footer>
      </Page>
    </Container>
  );
}
