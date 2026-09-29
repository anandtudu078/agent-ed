/**
 * The starter catalog.
 *
 * Lives outside the route file: this is content, not request handling, and it
 * grows every time the curriculum does.
 *
 * `category` is the index that makes the branches of a subject legible — the
 * AI material is deliberately split across "AI Foundations", "Machine
 * Learning", "Deep Learning", "Generative AI", and so on, rather than dumped
 * into one bucket where a student can't see the shape of the field.
 *
 * Each module's `topic` is the join key to a student's `topicsVisited`, so it
 * should read like something a tutor would say out loud ("backpropagation"),
 * never a slug ("module-3").
 */

export interface CurriculumCourse {
  title: string;
  category: string;
  description: string;
  level: "beginner" | "intermediate" | "advanced";
  modules: Array<{ title: string; topic: string }>;
}

const CURRICULUM: CurriculumCourse[] = [
  {
    title: "Introduction to Programming",
    category: "Programming",
    description: "Variables, loops, functions, and how code actually runs.",
    level: "beginner",
    modules: [
      { title: "Variables and types", topic: "variables and data types" },
      { title: "Conditionals", topic: "if statements and conditionals" },
      { title: "Loops", topic: "loops and iteration" },
      { title: "Functions", topic: "functions and parameters" },
      { title: "Debugging", topic: "debugging and reading errors" },
    ],
  },
  {
    title: "Web Development Basics",
    category: "Web Development",
    description: "HTML, CSS, and JavaScript — build your first web page.",
    level: "beginner",
    modules: [
      { title: "HTML structure", topic: "html structure and elements" },
      { title: "CSS styling", topic: "css styling and layout" },
      { title: "Responsive design", topic: "responsive web design" },
      { title: "DOM manipulation", topic: "dom manipulation" },
      { title: "Events", topic: "javascript events and handlers" },
    ],
  },
  {
    title: "Data Structures Fundamentals",
    category: "Computer Science",
    description: "Arrays, lists, stacks, queues, and when to reach for each.",
    level: "intermediate",
    modules: [
      { title: "Arrays", topic: "arrays and indexing" },
      { title: "Linked lists", topic: "linked lists" },
      { title: "Stacks and queues", topic: "stacks and queues" },
      { title: "Hash tables", topic: "hash tables and dictionaries" },
      { title: "Trees", topic: "trees and binary search trees" },
    ],
  },
  {
    title: "Algorithms Step by Step",
    category: "Computer Science",
    description: "Sorting, searching, and thinking about efficiency.",
    level: "intermediate",
    modules: [
      { title: "Big O notation", topic: "big o notation and time complexity" },
      { title: "Searching", topic: "searching algorithms" },
      { title: "Sorting", topic: "sorting algorithms" },
      { title: "Recursion", topic: "recursion" },
      { title: "Greedy and dynamic programming", topic: "dynamic programming" },
    ],
  },
  {
    title: "Databases & MongoDB",
    category: "Databases",
    description: "How data is stored, queried, and modelled in documents.",
    level: "intermediate",
    modules: [
      { title: "Data modelling", topic: "data modelling and schemas" },
      { title: "CRUD operations", topic: "crud operations" },
      { title: "Indexing", topic: "database indexing" },
      { title: "Aggregation", topic: "aggregation pipelines" },
      { title: "Transactions", topic: "database transactions" },
    ],
  },

  // ── AI: the classical branches ────────────────────────────────────────
  {
    title: "What Is Artificial Intelligence?",
    category: "AI Foundations",
    description:
      "Where AI came from, what counts as intelligence, and how the field splits.",
    level: "beginner",
    modules: [
      { title: "A short history of AI", topic: "history of artificial intelligence" },
      { title: "What makes a system intelligent", topic: "defining artificial intelligence" },
      { title: "Narrow vs general AI", topic: "narrow ai versus general ai" },
      { title: "The Turing test", topic: "turing test and machine intelligence" },
      { title: "Symbolic vs connectionist AI", topic: "symbolic versus connectionist ai" },
      { title: "Where AI is used today", topic: "real world applications of ai" },
    ],
  },
  {
    title: "Search & Problem Solving",
    category: "AI Foundations",
    description:
      "How a machine searches a space of possibilities and finds a good answer.",
    level: "intermediate",
    modules: [
      { title: "State space search", topic: "state space search" },
      { title: "Breadth-first search", topic: "breadth first search" },
      { title: "Depth-first search", topic: "depth first search" },
      { title: "Heuristic search", topic: "heuristic search and heuristics" },
      { title: "A* algorithm", topic: "a star algorithm" },
      { title: "Constraint satisfaction", topic: "constraint satisfaction problems" },
      { title: "Minimax and game trees", topic: "minimax and game tree search" },
    ],
  },
  {
    title: "Logic & Knowledge Representation",
    category: "AI Foundations",
    description:
      "How facts, rules and relationships get represented so a machine can reason.",
    level: "intermediate",
    modules: [
      { title: "Propositional logic", topic: "propositional logic" },
      { title: "First-order logic", topic: "first order logic and predicates" },
      { title: "Forward and backward chaining", topic: "forward and backward chaining" },
      { title: "Rule engines", topic: "rule based systems" },
      { title: "Ontologies", topic: "ontologies and semantic description" },
      { title: "Knowledge graphs", topic: "knowledge graphs" },
    ],
  },
  {
    title: "Expert Systems",
    category: "AI Foundations",
    description:
      "The classic rule-based approach to AI, and where it still beats modern models.",
    level: "intermediate",
    modules: [
      { title: "How an expert system works", topic: "how expert systems work" },
      { title: "Inference engines", topic: "inference engines" },
      { title: "MYCIN and medical diagnosis", topic: "mycin expert system" },
      { title: "Handling uncertainty", topic: "uncertainty in expert systems" },
      {
        title: "When rules beat machine learning",
        topic: "expert systems versus machine learning",
      },
    ],
  },

  // ── AI: machine learning branches ─────────────────────────────────────
  {
    title: "Machine Learning Concepts",
    category: "Machine Learning",
    description: "What models are, how they learn, and where AI shows up daily.",
    level: "beginner",
    modules: [
      { title: "What is a model", topic: "machine learning models" },
      { title: "Features and labels", topic: "features and labels in machine learning" },
      { title: "Training data", topic: "training data" },
      { title: "Overfitting and underfitting", topic: "overfitting and underfitting" },
      { title: "Train, validation and test splits", topic: "train validation and test split" },
      { title: "Evaluation metrics", topic: "model evaluation and metrics" },
      { title: "Everyday AI", topic: "everyday applications of ai" },
    ],
  },
  {
    title: "Supervised Learning",
    category: "Machine Learning",
    description: "Learning from labelled examples: predicting numbers and labels.",
    level: "intermediate",
    modules: [
      { title: "Regression", topic: "linear and polynomial regression" },
      { title: "Classification", topic: "classification problems" },
      { title: "k-nearest neighbours", topic: "k nearest neighbours algorithm" },
      { title: "Decision trees", topic: "decision trees" },
      { title: "Support vector machines", topic: "support vector machines" },
      { title: "Ensembles and bagging", topic: "ensembles and bagging" },
      { title: "Gradient boosting", topic: "gradient boosting" },
    ],
  },
  {
    title: "Unsupervised Learning",
    category: "Machine Learning",
    description: "Finding structure in data that arrives without any labels.",
    level: "intermediate",
    modules: [
      { title: "Clustering", topic: "clustering" },
      { title: "k-means", topic: "k means clustering" },
      { title: "Hierarchical clustering", topic: "hierarchical clustering" },
      { title: "Dimensionality reduction", topic: "dimensionality reduction" },
      { title: "Principal component analysis", topic: "principal component analysis" },
      { title: "Association rules", topic: "association rules and market basket analysis" },
      { title: "Anomaly detection", topic: "anomaly detection" },
    ],
  },
  {
    title: "Reinforcement Learning",
    category: "Machine Learning",
    description: "Learning by trial, error and reward — how machines learn to act.",
    level: "advanced",
    modules: [
      {
        title: "The agent-environment loop",
        topic: "agents and environments in reinforcement learning",
      },
      { title: "Markov decision processes", topic: "markov decision process" },
      { title: "Rewards and returns", topic: "rewards and discounted returns" },
      { title: "Q-learning", topic: "q learning algorithm" },
      { title: "Exploration vs exploitation", topic: "exploration versus exploitation" },
      { title: "Policy gradients", topic: "policy gradient methods" },
      { title: "Applications of RL", topic: "applications of reinforcement learning" },
    ],
  },

  // ── AI: deep learning ─────────────────────────────────────────────────
  {
    title: "Neural Networks Explained",
    category: "Deep Learning",
    description:
      "How a network learns: neurons, layers, weights, and why training actually works.",
    level: "advanced",
    modules: [
      { title: "The perceptron", topic: "perceptrons and artificial neurons" },
      { title: "Layers and activation", topic: "layers and activation functions" },
      { title: "Weights and bias", topic: "weights and bias in neural networks" },
      { title: "Forward pass", topic: "forward pass in a neural network" },
      { title: "Backpropagation", topic: "backpropagation" },
      { title: "Gradient descent", topic: "gradient descent" },
      { title: "Training a network", topic: "training a neural network from scratch" },
    ],
  },
  {
    title: "Deep Learning Architectures",
    category: "Deep Learning",
    description:
      "The specific network shapes that made vision, speech and generation work.",
    level: "advanced",
    modules: [
      { title: "Convolutional networks", topic: "convolutional neural networks" },
      { title: "Pooling and feature maps", topic: "pooling and feature maps" },
      { title: "Recurrent networks", topic: "recurrent neural networks" },
      { title: "LSTM and gated memory", topic: "lstm and gated recurrent units" },
      { title: "Autoencoders", topic: "autoencoders" },
      { title: "Residual connections", topic: "residual connections and skip layers" },
      { title: "Generative adversarial networks", topic: "generative adversarial networks" },
    ],
  },
  {
    title: "Training & Optimization",
    category: "Deep Learning",
    description: "The craft of getting a network to actually converge and generalise.",
    level: "advanced",
    modules: [
      { title: "Loss functions", topic: "loss functions in machine learning" },
      { title: "Optimizers", topic: "optimizers like sgd and adam" },
      { title: "Regularization", topic: "regularization and early stopping" },
      { title: "Dropout and batch normalization", topic: "dropout and batch normalization" },
      { title: "Hyperparameter tuning", topic: "hyperparameter tuning" },
      { title: "Transfer learning", topic: "transfer learning and pretrained models" },
      { title: "Reading a training curve", topic: "diagnosing model training curves" },
    ],
  },

  // ── AI: generative ────────────────────────────────────────────────────
  {
    title: "Transformers & Large Language Models",
    category: "Generative AI",
    description:
      "Attention, tokens, and how models like this one actually generate text.",
    level: "advanced",
    modules: [
      { title: "Tokens and vocabulary", topic: "tokens and tokenization" },
      { title: "The attention mechanism", topic: "self attention mechanism" },
      { title: "Query, key and value", topic: "query key and value in attention" },
      { title: "Multi-head attention", topic: "multi head attention" },
      { title: "Positional encoding", topic: "positional encoding in transformers" },
      { title: "Pretraining and fine-tuning", topic: "pretraining and fine tuning" },
      { title: "Autoregressive generation", topic: "autoregressive text generation" },
      { title: "Context windows", topic: "context window and token limits" },
      { title: "Hallucination", topic: "llm hallucination and why it happens" },
    ],
  },
  {
    title: "Generative Models",
    category: "Generative AI",
    description: "How machines make new things — images, text, audio and video.",
    level: "advanced",
    modules: [
      { title: "What is generative AI", topic: "generative ai" },
      { title: "Variational autoencoders", topic: "variational autoencoders" },
      { title: "Adversarial training", topic: "adversarial training in gans" },
      { title: "Diffusion models", topic: "diffusion models" },
      { title: "Denoising in diffusion", topic: "denoising steps in diffusion models" },
      { title: "Text-to-image models", topic: "text to image generation" },
      { title: "Video generation", topic: "ai video generation" },
    ],
  },
  {
    title: "Prompting & Retrieval",
    category: "Generative AI",
    description: "Getting better answers from a model, and giving it your own data.",
    level: "intermediate",
    modules: [
      { title: "Anatomy of a prompt", topic: "prompt engineering basics" },
      { title: "Zero-shot vs few-shot", topic: "zero shot and few shot prompting" },
      { title: "Chain of thought", topic: "chain of thought prompting" },
      { title: "Embeddings", topic: "vector embeddings and similarity" },
      { title: "Retrieval augmented generation", topic: "retrieval augmented generation rag" },
      { title: "Vector databases", topic: "vector databases and indexing" },
      { title: "Building an AI assistant", topic: "building an ai assistant" },
    ],
  },

  // ── AI: language and perception ───────────────────────────────────────
  {
    title: "Natural Language Processing",
    category: "Natural Language",
    description: "How machines read, understand and generate human language.",
    level: "intermediate",
    modules: [
      { title: "Text preprocessing", topic: "text preprocessing and cleaning" },
      { title: "Bag of words and TF-IDF", topic: "bag of words and tf idf" },
      { title: "Named entity recognition", topic: "named entity recognition" },
      { title: "Sentiment analysis", topic: "sentiment analysis" },
      { title: "Text classification", topic: "text classification" },
      { title: "Language models for text", topic: "language models for text" },
      { title: "Machine translation", topic: "machine translation" },
      { title: "Question answering", topic: "question answering systems" },
      { title: "Multilingual models", topic: "multilingual nlp models" },
    ],
  },
  {
    title: "Computer Vision",
    category: "Computer Vision",
    description: "Teaching machines to see: from pixels to decisions.",
    level: "advanced",
    modules: [
      { title: "Images as arrays of pixels", topic: "images as pixel arrays" },
      { title: "Image classification", topic: "image classification" },
      { title: "Convolutional filters", topic: "convolutional filters on images" },
      { title: "Object detection", topic: "object detection" },
      { title: "Image segmentation", topic: "image segmentation" },
      { title: "Image generation", topic: "ai image generation" },
      { title: "Vision transformers", topic: "vision transformers" },
      { title: "Multimodal models", topic: "multimodal models and clip" },
    ],
  },
  {
    title: "Speech & Audio AI",
    category: "Speech & Audio",
    description: "How machines hear speech, recognise voices and make sound.",
    level: "advanced",
    modules: [
      { title: "How sound becomes data", topic: "audio spectrograms and features" },
      { title: "Speech recognition", topic: "automatic speech recognition" },
      { title: "Text to speech", topic: "text to speech synthesis" },
      { title: "Speaker recognition", topic: "speaker recognition and verification" },
      { title: "Voice assistants", topic: "building voice assistants" },
      { title: "Music generation", topic: "ai music generation" },
    ],
  },
  {
    title: "Robotics & Autonomous Systems",
    category: "Robotics",
    description: "AI that moves: perceiving the world and acting inside it.",
    level: "advanced",
    modules: [
      { title: "Sensors and perception", topic: "robot sensors and perception" },
      { title: "Robotics kinematics", topic: "robot kinematics" },
      { title: "Motion planning", topic: "robot motion planning" },
      { title: "Control systems", topic: "robot control systems" },
      { title: "Simultaneous localisation and mapping", topic: "slam simultaneous localisation and mapping" },
      { title: "Computer vision for robotics", topic: "computer vision in robotics" },
      { title: "Self-driving vehicles", topic: "autonomous vehicles and self driving" },
    ],
  },

  // ── AI: responsible use and deployment ────────────────────────────────
  {
    title: "AI Ethics & Fairness",
    category: "Responsible AI",
    description: "Who AI hurts, why, and what can be done about it.",
    level: "intermediate",
    modules: [
      { title: "How bias enters a dataset", topic: "bias in training data" },
      { title: "Sampling bias", topic: "sampling bias" },
      { title: "Fairness metrics", topic: "fairness metrics in machine learning" },
      { title: "The fairness trade-offs", topic: "the impossibility of fairness" },
      { title: "Privacy and data protection", topic: "data privacy in machine learning" },
      { title: "Explainability", topic: "explainable ai and interpretability" },
      { title: "Accountability", topic: "accountability for ai decisions" },
    ],
  },
  {
    title: "AI Safety & Alignment",
    category: "Responsible AI",
    description: "Making sure increasingly capable systems stay useful and safe.",
    level: "advanced",
    modules: [
      { title: "What alignment means", topic: "ai alignment" },
      { title: "Specification problems", topic: "the specification problem in ai" },
      { title: "Human feedback and RLHF", topic: "human feedback and rlhf" },
      { title: "Interpretability research", topic: "mechanistic interpretability" },
      { title: "Red teaming", topic: "red teaming ai models" },
      { title: "Adversarial examples", topic: "adversarial examples and attacks" },
      { title: "Misuse and misuse prevention", topic: "ai misuse and deepfakes" },
    ],
  },
  {
    title: "AI in Production",
    category: "Responsible AI",
    description: "Shipping a model, keeping it honest, and keeping it affordable.",
    level: "advanced",
    modules: [
      { title: "From notebook to service", topic: "machine learning operations mlops" },
      { title: "Model deployment", topic: "deploying machine learning models" },
      { title: "Monitoring in production", topic: "monitoring models in production" },
      { title: "Model drift", topic: "model drift and data drift" },
      { title: "Inference cost and latency", topic: "inference cost and latency" },
      { title: "Choosing a model", topic: "choosing the right model for a task" },
      { title: "When not to use AI", topic: "when not to use machine learning" },
    ],
  },
  {
    title: "AI Across Industries",
    category: "Responsible AI",
    description: "Where these techniques land in the real world, domain by domain.",
    level: "intermediate",
    modules: [
      { title: "AI in healthcare", topic: "ai in healthcare" },
      { title: "AI in finance", topic: "ai in finance and banking" },
      { title: "AI in education", topic: "ai in education" },
      { title: "AI in transport", topic: "ai in transport and logistics" },
      { title: "AI in agriculture", topic: "ai in agriculture" },
      { title: "AI for accessibility", topic: "ai for accessibility" },
    ],
  },
];

export default CURRICULUM;

/**
 * Starter courses that were renamed or folded into another course and are no
 * longer part of the curriculum.
 *
 * This is an explicit allowlist on purpose. The seeder inserts and syncs by
 * title, so a course that disappears from CURRICULUM would otherwise linger
 * forever as a ghost — which is exactly what happened to "AI in Practice" when
 * it became "AI in Production", leaving a duplicate stranded in a category
 * nothing else used.
 *
 * Naming the retired titles here means we can only ever delete something
 * somebody deliberately decided to remove. Anything not listed here is left
 * alone forever.
 */
export const RETIRED_COURSE_TITLES: ReadonlySet<string> = new Set([
  "AI in Practice",
]);

