import bodyParser from 'body-parser';
import { config } from 'dotenv';
import express from 'express';
import { AzureOpenAI } from 'openai';
import axios from 'axios';
import { marked } from 'marked';
config();

const azureOpenAIKey = process.env.AZURE_OPENAI_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const azureOpenAIVersion = process.env.AZURE_OPENAI_VERSION;

const bingKey = process.env.BING_SEARCH_KEY;
const bingEndpoint = process.env.BING_SEARCH_ENDPOINT;

const app = express();
app.set('view engine', 'ejs');
app.set('views', './views'); 
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
const port = process.env.PORT || 3000;

// console.log(azureOpenAIKey);
// console.log(azureOpenAIEndpoint);
// console.log(azureOpenAIDeployment);
// console.log(azureOpenAIVersion);
if (!azureOpenAIKey || !azureOpenAIEndpoint || !azureOpenAIDeployment || !azureOpenAIVersion) {
    throw new Error(
      "You need to set the endpoint, deployment name, and API version."
    );
}

async function getWeather(location){
  const query = `What is the weather like in ${location}`;
  const url = `${bingEndpoint}/v7.0/search?q=${encodeURIComponent(query)}`;
  try
  {
    const response = await axios.get(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': bingKey
      }
    });
    
    const webPages = response.data.webPages?.value;
    if(webPages && webPages.length > 0)
    {
      return webPages[0].snippet;
    }
    else
    {
      return `Couldn't find weather information for ${location}.`;
    }
  }
  catch(error)
  {
    console.error('Error occurred while calling Bing Search API:', error.response?.data || error.message || error);
    return `Failed to get weather for ${location}.`;
    // if(!bingKey)
    // {
    //   console.error('Bing Search Resource Key is empty.');
    //   return `Failed to get weather for ${location}.`;
    // }
    // if(!bingEndpoint)
    // {
    //   console.error('Bing Search Resource Endpoint is empty.');
    //   return `Failed to get weather for ${location}.`;
    // }
    // else
    // {
    //   console.error('The error exists but it does not pertain to Bing Search Resource Key or Endpoint.');
    //   return `Failed to get weather for ${location}.`;
    // }
  }
}

async function main(prompt) {
    const getClient = () => {
        const assistantsClient = new AzureOpenAI({
            endpoint: azureOpenAIEndpoint,
            apiVersion: azureOpenAIVersion,
            apiKey: azureOpenAIKey,
        });
        return assistantsClient;
    };
    
    const assistantsClient = getClient();
    const assistant = await assistantsClient.beta.assistants.create({
        model: azureOpenAIDeployment,
        name: "Weather App",
        instructions: "You are a weather assistant. Use tools when needed.",
        tools: [{
          type: "function",
          function: {
            name: "getWeather",
            description: "Get the weather in a location",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "City name like San Francisco"
                }
              },
              required: ["location"]
            }
          }
        }]
      });
    
    const role = "user";
    // const prompt = "I need to solve the equation `3x + 11 = 14`. Can you help me?";
    
    console.log(`Assistant created: ${JSON.stringify(assistant)}`);
    
    const assistantThread = await assistantsClient.beta.threads.create({});
    console.log(`Thread created: ${JSON.stringify(assistantThread)}`);
    
    const threadResponse = await assistantsClient.beta.threads.messages.create(
        assistantThread.id,
        {
            role,
            content: prompt,
        }
    );
    console.log(`Message created: ${JSON.stringify(threadResponse)}`);
    
    var runResponse = await assistantsClient.beta.threads.runs.createAndPoll(
        assistantThread.id,
        {
            assistant_id: assistant.id,
        },
        { pollIntervalMs: 500 }
    );
    console.log(`Run created: ${JSON.stringify(runResponse)}`);

    if (runResponse.required_action && runResponse.required_action.submit_tool_outputs) {
        const toolOutputs = [];
    
        for (const tool of runResponse.required_action.submit_tool_outputs.tool_calls) {
          if (tool.function.name === "getWeather") {
            const location = JSON.parse(tool.function.arguments).location;
            const weather = await getWeather(location);
    
            toolOutputs.push({
              tool_call_id: tool.id,
              output: weather
            });
          }
        }
        if (toolOutputs.length > 0) {
            runResponse = await assistantsClient.beta.threads.runs.submitToolOutputsAndPoll(
              assistantThread.id,
              runResponse.id,
              { tool_outputs: toolOutputs }
            );
        }
    }

    if (runResponse.status === 'completed') {
        const messages = await assistantsClient.beta.threads.messages.list(assistantThread.id);
        const response = [];
    
        for (const message of messages.data) {
          for (const item of message.content) {
            if (item.type === 'text') {
              response.push(item.text.value);
            }
          }
        }
    
        return response;
      } else {
        return [`Run not completed. Status: ${runResponse.status}`];
      }
}

app.get('/', (req, res) => {
    res.render("index.ejs");
});

app.post('/chat', async(req, res) => {
    console.log("Prompt: ", req.body.prompt);
    var prompt = req.body.prompt;
    var answer = await main(prompt);
    var htmlResponse = marked.parse(answer[0]);
    res.render('index.ejs', {
        prompt: prompt,
        response: htmlResponse
    });
});

app.listen(port, (error) => {
    if(error)
      console.error('There is something wrong with the app server');
  
    console.log(`Server is running on http://localhost:${port}`);
  
  })