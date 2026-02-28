import { useEffect, useState } from 'react';
import { apiRequest } from '../utils/api';
import { MonitorTemplate, TemplateSummary } from '../utils/types';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<MonitorTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<TemplateSummary[]>('/api/templates')
      .then((response) => {
        setTemplates(response.data);
        if (response.data[0]) {
          setSelectedTemplateId(response.data[0].id);
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) {
      setSelectedTemplate(null);
      return;
    }
    apiRequest<MonitorTemplate>(`/api/templates/${selectedTemplateId}`)
      .then((response) => setSelectedTemplate(response.data))
      .catch((err) => setError(err.message));
  }, [selectedTemplateId]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Templates</h1>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="card-grid">
        <div className="card">
          <h3>Available templates</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Tags</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr
                  key={template.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <td>{template.name}</td>
                  <td>{template.description}</td>
                  <td>{template.tags.join(', ')}</td>
                  <td>{template.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Template details</h3>
          {!selectedTemplate && <div className="helper">Select a template to view details.</div>}
          {selectedTemplate && (
            <div>
              <div className="helper">ID: {selectedTemplate.id}</div>
              <div className="helper">Name: {selectedTemplate.name}</div>
              <div className="helper">Description: {selectedTemplate.description}</div>
              <div className="helper">Tags: {selectedTemplate.tags.join(', ')}</div>
              <div className="helper">Version: {selectedTemplate.version}</div>
              <div className="section">
                <pre className="json-preview">
                  {JSON.stringify(selectedTemplate.monitor_defaults, null, 2)}
                </pre>
              </div>
              {selectedTemplate.id === 'durham-orthodontics-approved-payment' && (
                <div className="notice">
                  Delivery mapping for orthodontics events is optional and can be added separately.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
